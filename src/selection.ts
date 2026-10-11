/** Select P1/B1 using single-byte writes; preserve and verify every other byte. */
export async function selectPresetOne(
  readMetadata: () => Promise<Buffer>,
  saveOriginal: (metadata: Buffer) => Promise<void>,
  writeByte: (address: number, value: number) => Promise<void>,
): Promise<Buffer> {
  let current = await readMetadata();
  if (
    current.length !== 12 ||
    current[7]! > 3 ||
    current.subarray(8).some((v) => v > 6)
  )
    throw Error("Invalid selection metadata; nothing written");

  if (current[7] === 0 && current[8] === 0) return current;
  await saveOriginal(Buffer.from(current));

  for (const address of [7, 8]) {
    if (current[address] === 0) continue;
    const expected = Buffer.from(current);
    expected[address] = 0;
    await writeByte(address, 0);
    const actual = await readMetadata();
    if (!actual.equals(expected))
      throw Error(
        `Selection readback mismatch at address ${address}; further writes disabled`,
      );
    current = actual;
  }
  return current;
}
