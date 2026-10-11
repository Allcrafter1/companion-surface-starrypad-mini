import { setTimeout as delay } from "node:timers/promises";
import { rgbAddress } from "../dist/colors.js";
import { openPrivateDevice, ProtocolClient } from "./midi-device.mjs";

const intervalMs = Number(process.argv[2] ?? "1");
if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000)
  throw Error("Interval must be between 1 and 1000 ms");

const { input, output, name } = openPrivateDevice();
const client = new ProtocolClient(input, output);
let originalBank;
let restored = false;

function colorsFrom(bank) {
  return Array.from({ length: 16 }, (_, pad) => {
    const address = rgbAddress(pad);
    return Buffer.from(bank.subarray(address, address + 3));
  });
}

function verifyColors(bank, expected) {
  for (let pad = 0; pad < 16; pad++) {
    const address = rgbAddress(pad);
    const actual = bank.subarray(address, address + 3);
    if (!actual.equals(expected[pad]))
      throw Error(`Pad ${pad + 1} mismatch: ${[...actual]} != ${[...expected[pad]]}`);
  }
}

try {
  console.log(`Opened ${name}`);
  await client.start();
  const metadata = await client.read(4, 0, 12);
  const flags = await client.read(5, 4704, 16);
  if (metadata[7] !== 0 || metadata[8] !== 0 || !flags.equals(Buffer.alloc(16)))
    throw Error("Expected safe Preset 1 / Bank 1 state; no RGB writes sent");
  originalBank = await client.read(5, 0, 672);
  const original = colorsFrom(originalBank);
  const temporary = original.map((color) =>
    Buffer.from([...color].map((value) => 255 - value)),
  );

  const started = process.hrtime.bigint();
  for (let pad = 0; pad < 16; pad++) {
    client.write(5, rgbAddress(pad), temporary[pad]);
    if (intervalMs > 0) await delay(intervalMs);
  }
  const sendMs = Number(process.hrtime.bigint() - started) / 1e6;
  await delay(50);
  verifyColors(await client.read(5, 0, 672), temporary);

  for (let pad = 0; pad < 16; pad++) {
    client.write(5, rgbAddress(pad), original[pad]);
    if (intervalMs > 0) await delay(intervalMs);
  }
  await delay(50);
  verifyColors(await client.read(5, 0, 672), original);
  restored = true;

  console.log(`16 RGB writes at ${intervalMs} ms interval queued in ${sendMs.toFixed(2)} ms`);
  console.log("All 16 temporary colors verified; all originals restored and verified");
} finally {
  if (originalBank && !restored) {
    console.error("Burst failed; restoring 16 original colors with 50 ms spacing");
    const original = colorsFrom(originalBank);
    for (let pad = 0; pad < 16; pad++) {
      try {
        client.write(5, rgbAddress(pad), original[pad]);
        await delay(50);
      } catch {}
    }
    try {
      verifyColors(await client.read(5, 0, 672), original);
      console.error("Emergency restore verified");
    } catch (error) {
      console.error(`Emergency restore verification failed: ${error.message}`);
    }
  }
  client.close();
}
