import test from "node:test";
import assert from "node:assert/strict";
import {
  packet,
  write,
  read,
  decode,
  readResponse,
  FrameStream,
} from "../dist/sysex.js";
import { Colors, rgbAddress, RGB_ADDRESSES } from "../dist/colors.js";
import {
  parseNotes,
  DEFAULT_NOTES,
  controlIdToHardwarePad,
} from "../dist/mapping.js";
import { matchesPort, stableSurfaceId } from "../dist/main.js";
import {
  matchLinuxDeviceIdentities,
  parseAlsaPort,
  scanLinuxUsbMidiDevices,
} from "../dist/linux-device.js";
test("documented P3/B3/Pad13 red exact reference vector", () => {
  const expected =
    "f0 00 32 09 59 00 00 40 02 23 58 00 00 30 00 00 00 7f 01 00 48 0a f7"
      .split(" ")
      .map((x) => parseInt(x, 16));
  assert.deepEqual(write(5, 11299, Uint8Array.from([255, 0, 0])), expected);
  assert.equal(decode(expected).command, 0x22);
});
test("all byte values and lengths survive continuous packing", () => {
  for (let n = 0; n < 300; n++) {
    const data = Uint8Array.from({ length: n }, (_, i) => i % 256);
    assert.deepEqual(decode(packet(0x23, data)).data, Buffer.from(data));
  }
});
test("reject checksum, length, framing and nonzero padding", () => {
  const good = packet(0x11, Uint8Array.of(0));
  for (const bad of [
    good.slice(1),
    [...good.slice(0, -1)],
    [...good.slice(0, -2), 127, 247],
  ])
    assert.throws(() => decode(bad));
  const corrupt = packet(0x22, Uint8Array.of(255));
  corrupt[8] ^= 1;
  assert.throws(() => decode(corrupt));
  assert.throws(() => readResponse(decode(read(5, 0, 3))));
});
test("stream fragments, real time bytes, concatenation and recovery", () => {
  const p = packet(0x11);
  const s = new FrameStream();
  assert.deepEqual(s.push(p.slice(0, 4)), []);
  assert.equal(s.push([248, ...p.slice(4), ...p]).length, 2);
  assert.equal(s.push([240, 0, 144, ...p]).length, 1);
});
test("stream reports corrupt frames without losing resynchronisation", () => {
  const errors = [];
  const corrupt = packet(0x11, Uint8Array.of(1));
  corrupt[8] ^= 1;
  const stream = new FrameStream();
  assert.deepEqual(stream.push(corrupt, (error) => errors.push(error)), []);
  assert.equal(errors.length, 1);
  assert.equal(stream.push(packet(0x11)).length, 1);
});
test("fixed P1/B1 RGB addresses and bounds", () => {
  assert.equal(rgbAddress(0), 5);
  assert.equal(rgbAddress(12), 509);
  assert.equal(rgbAddress(15), 635);
  assert.equal(new Set(RGB_ADDRESSES).size, 16);
  assert.throws(() => rgbAddress(16));
});
test("dedupe, latest value, and revert during in-flight write", () => {
  const c = new Colors();
  c.seed(0, [1, 2, 3]);
  c.set(0, [1, 2, 3]);
  assert.equal(c.next(), undefined);
  c.set(0, [4, 5, 6]);
  c.set(0, [7, 8, 9]);
  assert.deepEqual(c.next(), [0, [7, 8, 9]]);
  c.set(0, [1, 2, 3]);
  c.sent(0, [7, 8, 9]);
  assert.deepEqual(c.next(), [0, [1, 2, 3]]);
  c.sent(0, [1, 2, 3]);
  assert.equal(c.next(), undefined);
});
test("explicit input mapping and ALSA port matching", () => {
  assert.equal(parseNotes(DEFAULT_NOTES).size, 16);
  assert.equal(parseNotes(DEFAULT_NOTES).get(9 * 128 + 16), "0/0");
  assert.equal(parseNotes(DEFAULT_NOTES).get(9 * 128 + 4), "3/0");
  assert.equal(
    parseNotes(["1:36", ...Array(15).fill("-")].join(",")).get(36),
    "0/0",
  );
  assert.throws(() => parseNotes("1:36"));
  assert.equal(controlIdToHardwarePad("0/0"), 12);
  assert.equal(controlIdToHardwarePad("0/3"), 15);
  assert.equal(controlIdToHardwarePad("3/0"), 0);
  assert.equal(controlIdToHardwarePad("3/3"), 3);
  assert.equal(controlIdToHardwarePad("4/0"), undefined);
  assert(matchesPort("STARRYPAD MINI:STARRYPAD MINI-Private 24:0"));
  assert(matchesPort("STARRYPAD MINI-Private"));
  assert(matchesPort("SINCO:SINCO STARRYPAD MINI-Private 20:0"));
  assert(!matchesPort("STARRYPAD MINI-MIDI"));
  assert.equal(
    stableSurfaceId("SINCO:SINCO STARRYPAD MINI-Private 20:0"),
    stableSurfaceId("SINCO:SINCO STARRYPAD MINI-Private 27:0"),
  );
});

test("Linux identity follows a unique USB serial across ALSA renumbering", () => {
  const devices = [
    { card: 3, device: 0, serial: "SERIAL-B", usbPath: "1-4" },
    { card: 1, device: 0, serial: "SERIAL-A", usbPath: "1-2" },
  ];
  const first = matchLinuxDeviceIdentities(
    ["STARRYPAD MINI-Private 24:0", "STARRYPAD MINI-Private 20:0"],
    devices,
  );
  const second = matchLinuxDeviceIdentities(
    ["STARRYPAD MINI-Private 41:0", "STARRYPAD MINI-Private 39:0"],
    devices,
  );
  assert.equal(
    first.get("STARRYPAD MINI-Private 20:0").surfaceId,
    second.get("STARRYPAD MINI-Private 39:0").surfaceId,
  );
  assert.equal(
    first.get("STARRYPAD MINI-Private 24:0").surfaceId,
    second.get("STARRYPAD MINI-Private 41:0").surfaceId,
  );
  assert.notEqual(
    first.get("STARRYPAD MINI-Private 20:0").surfaceId,
    first.get("STARRYPAD MINI-Private 24:0").surfaceId,
  );
});

test("Linux identity uses the USB path for missing or duplicate serials", () => {
  const identities = matchLinuxDeviceIdentities(
    ["STARRYPAD MINI-Private 20:0", "STARRYPAD MINI-Private 24:0"],
    [
      { card: 1, device: 0, serial: "SAME", usbPath: "1-2" },
      { card: 3, device: 0, serial: "SAME", usbPath: "1-4" },
    ],
  );
  assert.match(
    identities.get("STARRYPAD MINI-Private 20:0").surfaceId,
    /linux-usb-path/,
  );
  assert.notEqual(
    identities.get("STARRYPAD MINI-Private 20:0").surfaceId,
    identities.get("STARRYPAD MINI-Private 24:0").surfaceId,
  );
  const missing = matchLinuxDeviceIdentities(
    ["STARRYPAD MINI-Private 20:0"],
    [{ card: 1, device: 0, usbPath: "2-3" }],
  );
  assert.equal(
    missing.get("STARRYPAD MINI-Private 20:0").description,
    "USB port 2-3",
  );
});

test("Linux identity refuses ambiguous or non-ALSA mappings", () => {
  const device = { card: 1, device: 0, serial: "A", usbPath: "1-2" };
  assert.equal(
    matchLinuxDeviceIdentities(
      ["STARRYPAD MINI-Private 20:0", "STARRYPAD MINI-Private 24:0"],
      [device],
    ).size,
    0,
  );
  assert.equal(
    matchLinuxDeviceIdentities(["STARRYPAD MINI-Private"], [device]).size,
    0,
  );
  assert.deepEqual(parseAlsaPort("Device 123:4"), {
    name: "Device 123:4",
    client: 123,
    port: 4,
  });
});

test("Linux sysfs scan tolerates an unavailable tree", async () => {
  assert.deepEqual(
    await scanLinuxUsbMidiDevices("/path/which/does/not/exist"),
    [],
  );
});
