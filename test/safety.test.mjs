import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { StarryPad } from "../dist/instance.js";
import { decode, packet } from "../dist/sysex.js";
test("failed selection readback blocks RGB; input note releases; close and blank never write", async () => {
  const input = new EventEmitter();
  Object.assign(input, { ignoreTypes() {}, closePort() {}, destroy() {} });
  const sent = [];
  const events = [];
  const output = {
    sendMessage(bytes) {
      sent.push(bytes);
      const f = decode(bytes);
      if (f.command === 0x23) {
        const data = Buffer.alloc(20);
        data.set(f.data);
        data[8 + 7] = 2;
        queueMicrotask(() => input.emit("message", 0, packet(0x23, data)));
      }
    },
    closePort() {},
    destroy() {},
  };
  const surface = new StarryPad("test", input, output, "in", "out", {
    keyDownById: (id) => events.push(["down", id]),
    keyUpById: (id) => events.push(["up", id]),
    disconnect() {},
  });
  await surface.updateConfig({});
  const backupRoot = await mkdtemp(join(tmpdir(), "starrypad-test-"));
  const previousHome = process.env.HOME;
  process.env.HOME = backupRoot;
  try {
    await surface.init();
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(backupRoot, { recursive: true, force: true });
  }
  input.emit("noteon", 16, 100, { channel: 9 });
  input.emit("noteon", 16, 0, { channel: 9 });
  input.emit("noteoff", 4, 0, { channel: 9 });
  await surface.draw(new AbortController().signal, {
    controlId: "0/0",
    color: "#ff0000",
  });
  await surface.blank();
  await surface.close();
  assert.deepEqual(events, []);
  assert.deepEqual(
    sent.map((x) => decode(x).command),
    [0x11, 0x23, 0x22, 0x23],
  );
});

import { selectPresetOne } from "../dist/selection.js";
function selectionMock(preset, bank, corrupt = false) {
  let metadata = Buffer.from([7, 6, 5, 4, 3, 2, 1, preset, bank, 1, 2, 3]);
  const events = [];
  return {
    events,
    run: () =>
      selectPresetOne(
        async () => {
          events.push("read");
          return Buffer.from(metadata);
        },
        async (b) => events.push(["save", ...b]),
        async (address, value) => {
          events.push(["write", address, value]);
          metadata[address] = value;
          if (corrupt) metadata[0] ^= 1;
        },
      ),
  };
}
test("P1/B1 saves metadata and sends no unchanged selection writes", async () => {
  const m = selectionMock(0, 0);
  await m.run();
  assert.deepEqual(
    m.events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ["read"],
  );
});
test("selection writes only bytes 7 then 8 and verifies each full metadata frame", async () => {
  const m = selectionMock(2, 3);
  const result = await m.run();
  assert.deepEqual(
    m.events.filter((e) => Array.isArray(e) && e[0] === "write"),
    [
      ["write", 7, 0],
      ["write", 8, 0],
    ],
  );
  assert.deepEqual(
    m.events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ["read", "save", "write", "read", "write", "read"],
  );
  assert.deepEqual([...result], [7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3]);
});
test("unexpected metadata changes stop selection before next write", async () => {
  const m = selectionMock(2, 3, true);
  await assert.rejects(m.run(), /readback mismatch/);
  assert.equal(
    m.events.filter((e) => Array.isArray(e) && e[0] === "write").length,
    1,
  );
});
test("failed metadata backup prevents selection writes", async () => {
  let writes = 0;
  await assert.rejects(
    selectPresetOne(
      async () => Buffer.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0]),
      async () => {
        throw Error("disk full");
      },
      async () => {
        writes++;
      },
    ),
    /disk full/,
  );
  assert.equal(writes, 0);
});
