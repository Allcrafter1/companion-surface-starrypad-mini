import { setTimeout as delay } from "node:timers/promises";
import { openPrivateDevice, ProtocolClient } from "./midi-device.mjs";

const RGB_ADDRESS = 5;
const FLAGS_ADDRESS = 4704;
const { input, output, name } = openPrivateDevice();
const client = new ProtocolClient(input, output);
let original;
let changed = false;
let restored = false;

try {
  console.log(`Opened ${name}`);
  await client.start();
  const metadataBefore = await client.read(4, 0, 12);
  if (metadataBefore.length !== 12 || metadataBefore[7] !== 0 || metadataBefore[8] !== 0)
    throw Error("Expected Preset 1 / Bank 1; no RGB write sent");
  const flagsBefore = await client.read(5, FLAGS_ADDRESS, 16);
  if (!flagsBefore.equals(Buffer.alloc(16)))
    throw Error("Preset 1 control flags are not normal; no RGB write sent");

  original = await client.read(5, RGB_ADDRESS, 3);
  const temporary = Buffer.from([...original].map((value) => 255 - value));
  const started = process.hrtime.bigint();
  client.write(5, RGB_ADDRESS, temporary);
  changed = true;
  await delay(50);
  const actualTemporary = await client.read(5, RGB_ADDRESS, 3);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (!actualTemporary.equals(temporary)) throw Error("Temporary RGB readback mismatch");

  client.write(5, RGB_ADDRESS, original);
  await delay(50);
  const actualOriginal = await client.read(5, RGB_ADDRESS, 3);
  if (!actualOriginal.equals(original)) throw Error("Original RGB restore mismatch");
  restored = true;

  const metadataAfter = await client.read(4, 0, 12);
  const flagsAfter = await client.read(5, FLAGS_ADDRESS, 16);
  if (!metadataAfter.equals(metadataBefore)) throw Error("Region 4 changed during RGB smoke test");
  if (!flagsAfter.equals(flagsBefore)) throw Error("Control flags changed during RGB smoke test");
  console.log(`Pad 1 RGB ${[...original]} -> ${[...temporary]} -> ${[...original]}`);
  console.log(`Single write plus 50 ms settle and readback: ${elapsedMs.toFixed(2)} ms`);
  console.log("Hardware smoke test passed; original color restored");
} finally {
  if (changed && !restored && original) {
    try {
      client.write(5, RGB_ADDRESS, original);
      console.error("Emergency restore write sent; readback was not completed");
    } catch {}
  }
  client.close();
}
