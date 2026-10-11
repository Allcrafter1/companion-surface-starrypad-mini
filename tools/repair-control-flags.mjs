import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openPrivateDevice, ProtocolClient } from "./midi-device.mjs";

const PRESET_SIZE = 4723;
const FLAGS_OFFSET = 4704;
const REGION5_SIZE = 18892;
const BAD_FLAGS = Buffer.from([
  0, 0, 125, 255, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0,
]);
const NORMAL_FLAGS = Buffer.alloc(16);
const backupDir = join(
  homedir(),
  ".local",
  "state",
  "companion-surface-starrypad-mini",
  "recovery",
);

async function readRegion5(client) {
  const result = Buffer.alloc(REGION5_SIZE);
  for (let address = 0; address < result.length; address += 1009) {
    const chunk = await client.read(
      5,
      address,
      Math.min(1009, result.length - address),
    );
    chunk.copy(result, address);
  }
  return result;
}

const { input, output, name } = openPrivateDevice();
const client = new ProtocolClient(input, output);
try {
  console.log(`Opened ${name}`);
  await client.start();
  const metadataBefore = await client.read(4, 0, 12);
  const before = await readRegion5(client);

  let repairs = 0;
  for (let preset = 0; preset < 4; preset++) {
    const address = preset * PRESET_SIZE + FLAGS_OFFSET;
    const flags = before.subarray(address, address + 16);
    if (flags.equals(NORMAL_FLAGS)) continue;
    if (!flags.equals(BAD_FLAGS))
      throw Error(
        `Preset ${preset + 1} has an unknown control table: ${[...flags].join(",")}`,
      );
    repairs++;
  }

  if (!repairs) {
    console.log("No repair needed: all tables were already normal");
  } else {
    await mkdir(backupDir, { recursive: true });
    const stamp = Date.now();
    const beforePath = join(
      backupDir,
      `region5-control-flags-before-${stamp}.bin`,
    );
    await writeFile(beforePath, before, { flag: "wx", mode: 0o600 });
    console.log(`Saved pre-repair Region 5: ${beforePath}`);

    for (let preset = 0; preset < 4; preset++) {
      const address = preset * PRESET_SIZE + FLAGS_OFFSET;
      const original = before.subarray(address, address + 16);
      if (original.equals(NORMAL_FLAGS)) continue;
      const current = await client.read(5, address, 16);
      if (!current.equals(BAD_FLAGS))
        throw Error(`Preset ${preset + 1} changed before repair; nothing written`);
      client.write(5, address, NORMAL_FLAGS);
      await delay(50);
      const actual = await client.read(5, address, 16);
      if (!actual.equals(NORMAL_FLAGS))
        throw Error(`Preset ${preset + 1} control-table readback mismatch`);
      console.log(`Preset ${preset + 1}: control table cleared and verified`);
    }

    const metadataAfter = await client.read(4, 0, 12);
    if (!metadataAfter.equals(metadataBefore))
      throw Error("Region 4 metadata changed during repair");
    const after = await readRegion5(client);
    const expected = Buffer.from(before);
    for (let preset = 0; preset < 4; preset++) {
      const address = preset * PRESET_SIZE + FLAGS_OFFSET;
      NORMAL_FLAGS.copy(expected, address);
    }
    if (!after.equals(expected))
      throw Error("Unexpected Region 5 changes detected after repair");

    const afterPath = join(backupDir, `region5-control-flags-after-${stamp}.bin`);
    await writeFile(afterPath, after, { flag: "wx", mode: 0o600 });
    console.log(`Saved verified Region 5: ${afterPath}`);
    console.log(`Repair complete: ${repairs} preset tables corrected`);
  }
} finally {
  client.close();
}
