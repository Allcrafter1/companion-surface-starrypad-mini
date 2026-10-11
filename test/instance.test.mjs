import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StarryPad } from "../dist/instance.js";
import { decode, packet } from "../dist/sysex.js";
import { KNOWN_BAD_CONTROL_FLAGS } from "../dist/configuration.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function request(frame) {
  return {
    region: frame.data[0],
    address: frame.data.readUInt32LE(1),
    count: frame.data.readUIntLE(5, 3),
  };
}

function makeRig(initialFlags = Buffer.alloc(16), options = {}) {
  const input = new EventEmitter();
  Object.assign(input, {
    ignoreTypes() {},
    isPortOpen: () => true,
    closePort() {},
    destroy() {},
  });
  const metadata = Buffer.alloc(12);
  const flags = Buffer.from(initialFlags);
  const bank = Buffer.alloc(672);
  const sent = [];
  let throwRgb = false;
  let flagReads = 0;
  const output = {
    isPortOpen: () => true,
    sendMessage(bytes) {
      const frame = decode(bytes);
      sent.push(frame);
      if (frame.command === 0x23) {
        const q = request(frame);
        let value;
        if (q.region === 4 && q.address === 0 && q.count === 12) value = metadata;
        else if (q.region === 5 && q.address === 4704 && q.count === 16) {
          value = Buffer.from(flags);
          flagReads++;
        } else if (q.region === 5 && q.address === 0 && q.count === 672) value = bank;
        else throw Error(`unexpected read ${JSON.stringify(q)}`);
        const data = Buffer.alloc(8 + q.count);
        frame.data.copy(data, 0, 0, 8);
        value.copy(data, 8);
        if (q.region === 5 && q.address === 4704)
          options.onFlagRead?.({ count: flagReads, flags });
        queueMicrotask(() => {
          input.emit("message", 0, packet(0x23, data));
          options.afterResponse?.(q);
        });
      } else if (frame.command === 0x22) {
        const q = request(frame);
        const value = frame.data.subarray(8);
        if (throwRgb && q.region === 5 && q.address < 672) throw Error("fake RGB failure");
        if (q.region === 5 && q.address === 4704 && value.length === 16) value.copy(flags);
        else if (q.region === 5 && q.address < 672) value.copy(bank, q.address);
        else if (q.region === 4) value.copy(metadata, q.address);
      }
    },
    closePort() {},
    destroy() {},
  };
  const events = [];
  const context = {
    keyDownById: (id) => events.push(["down", id]),
    keyUpById: (id) => events.push(["up", id]),
    disconnect: (error) => events.push(["disconnect", error.message]),
  };
  const surface = new StarryPad("test", input, output, "fake-in", "fake-out", context);
  return { input, sent, bank, flags, events, surface, setThrowRgb: (v) => (throwRgb = v) };
}

async function withHome(run) {
  const dir = await mkdtemp(join(tmpdir(), "starrypad-instance-"));
  const old = process.env.HOME;
  process.env.HOME = dir;
  try {
    return await run(dir);
  } finally {
    if (old === undefined) delete process.env.HOME;
    else process.env.HOME = old;
    await rm(dir, { recursive: true, force: true });
  }
}

test("minimal ready path is three reads; changed RGB is exactly one write", async () => {
  const rig = makeRig();
  await rig.surface.updateConfig({ rgbIntervalMs: "1" });
  await rig.surface.init();
  assert.deepEqual(
    rig.sent.map((f) => f.command),
    [0x11, 0x23, 0x23, 0x23],
  );
  assert.deepEqual(rig.sent.slice(1).map(request), [
    { region: 4, address: 0, count: 12 },
    { region: 5, address: 4704, count: 16 },
    { region: 5, address: 0, count: 672 },
  ]);

  await rig.surface.draw(new AbortController().signal, {
    controlId: "3/0",
    color: "#000000",
  });
  await tick();
  assert.equal(rig.sent.length, 4);

  await rig.surface.draw(new AbortController().signal, {
    controlId: "3/0",
    color: "#010203",
  });
  await tick();
  assert.equal(rig.sent.length, 5);
  const rgb = rig.sent.at(-1);
  assert.equal(rgb.command, 0x22);
  assert.deepEqual(request(rgb), { region: 5, address: 5, count: 3 });
  assert.deepEqual([...rgb.data.subarray(8)], [1, 2, 3]);
  await rig.surface.close();
});

test("known bad P1 flags are backed up, repaired once, and verified", async () => {
  await withHome(async () => {
    const rig = makeRig(KNOWN_BAD_CONTROL_FLAGS);
    await rig.surface.init();
    const writes = rig.sent.filter((f) => f.command === 0x22);
    assert.equal(writes.length, 1);
    assert.deepEqual(request(writes[0]), { region: 5, address: 4704, count: 16 });
    assert.deepEqual([...writes[0].data.subarray(8)], Array(16).fill(0));
    assert.deepEqual([...rig.flags], Array(16).fill(0));
    assert.equal(rig.sent.filter((f) => f.command === 0x23).length, 5);
    await rig.surface.close();
  });
});

test("unknown P1 flags degrade without writes or bank read", async () => {
  const rig = makeRig(Buffer.from([1, ...Array(15).fill(0)]));
  await rig.surface.init();
  await rig.surface.draw(new AbortController().signal, {
    controlId: "3/0",
    color: "#010203",
  });
  await tick();
  assert.deepEqual(rig.sent.map((f) => f.command), [0x11, 0x23, 0x23]);
  await rig.surface.close();
});

test("RGB transport error disconnects without a blind retry", async () => {
  const rig = makeRig();
  await rig.surface.init();
  rig.setThrowRgb(true);
  await rig.surface.draw(new AbortController().signal, {
    controlId: "3/0",
    color: "#010203",
  });
  await tick();
  assert.equal(rig.sent.filter((f) => f.command === 0x22).length, 1);
  assert.equal(rig.events.filter((e) => e[0] === "disconnect").length, 1);
});

test("close releases every physically held Companion key", async () => {
  const rig = makeRig();
  await rig.surface.init();
  rig.input.emit("noteon", 16, 100, { channel: 9 });
  await rig.surface.close();
  assert.deepEqual(rig.events, [
    ["down", "0/0"],
    ["up", "0/0"],
  ]);
});


test("mapping change releases a held key before replacing the map", async () => {
  const rig = makeRig();
  await rig.surface.init();
  rig.input.emit("noteon", 16, 100, { channel: 9 });
  await rig.surface.updateConfig({
    notes: ["10:99", ...Array(15).fill("-")].join(","),
  });
  assert.deepEqual(rig.events, [
    ["down", "0/0"],
    ["up", "0/0"],
  ]);
  await rig.surface.close();
});


test("flag change between detection and repair is never overwritten", async () => {
  await withHome(async () => {
    const rig = makeRig(KNOWN_BAD_CONTROL_FLAGS, {
      onFlagRead: ({ count, flags }) => {
        if (count === 1) flags[0] = 1;
      },
    });
    await rig.surface.init();
    assert.equal(rig.sent.filter((f) => f.command === 0x22).length, 0);
    assert.equal(rig.sent.filter((f) => f.command === 0x23).length, 3);
    await rig.surface.close();
  });
});

test("latest desired color is rechecked after an optional interval", async () => {
  const rig = makeRig();
  await rig.surface.updateConfig({ rgbIntervalMs: "30" });
  await rig.surface.init();
  const signal = new AbortController().signal;
  await rig.surface.draw(signal, { controlId: "3/0", color: "#010203" });
  await rig.surface.draw(signal, { controlId: "3/0", color: "#040506" });
  await rig.surface.draw(signal, { controlId: "3/0", color: "#010203" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const writes = rig.sent.filter((f) => f.command === 0x22);
  assert.equal(writes.length, 1);
  assert.deepEqual([...writes[0].data.subarray(8)], [1, 2, 3]);
  await rig.surface.close();
});

test("close during discovery prevents every later protocol request", async () => {
  const rig = makeRig();
  const initializing = rig.surface.init();
  await tick();
  await rig.surface.close();
  await initializing;
  assert.deepEqual(rig.sent.map((f) => f.command), [0x11]);
});

test("close after the final bank response cannot resurrect a ready session", async () => {
  let rig;
  rig = makeRig(Buffer.alloc(16), {
    afterResponse: (q) => {
      if (q.region === 5 && q.address === 0 && q.count === 672)
        void rig.surface.close();
    },
  });
  await rig.surface.init();
  assert.equal(rig.surface.state, "disconnected");
  assert.equal(rig.surface.safe, false);
});


test("zero RGB interval is rejected in favor of measured 1 ms minimum", async () => {
  const rig = makeRig();
  await rig.surface.updateConfig({ rgbIntervalMs: "0" });
  assert.equal(rig.surface.rgbIntervalMs, 1);
  await rig.surface.close();
});
