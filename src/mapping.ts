// Measured on P1/B1 in physical row order, top-left to bottom-right.
// The printed numbering runs bottom-up: Pad 13 is top-left; Pad 1 is bottom-left.
// Note events use MIDI channel 10 (zero-based status nibble 9).
export const PAD_NOTES = [
  16, 17, 18, 19, 12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7,
] as const;
export const DEFAULT_NOTES = PAD_NOTES.map((note) => `10:${note}`).join(",");
export function parseNotes(value: string): Map<number, string> {
  const entries = value.split(",").map((v) => v.trim());
  if (entries.length !== 16)
    throw Error("Expected 16 comma-separated channel:note entries (or -)");
  const result = new Map<number, string>();
  entries.forEach((v, pad) => {
    if (v === "-") return;
    const m = /^(\d+):(\d+)$/.exec(v);
    if (!m) throw Error("Use channel:note or -");
    const channel = Number(m[1]),
      note = Number(m[2]);
    if (channel < 1 || channel > 16 || note > 127)
      throw Error("Channel 1..16, note 0..127 required");
    const key = (channel - 1) * 128 + note;
    if (result.has(key)) throw Error("Duplicate channel/note");
    result.set(key, `${Math.floor(pad / 4)}/${pad % 4}`);
  });
  return result;
}

export function controlIdToHardwarePad(controlId: string): number | undefined {
  const match = /^([0-3])\/([0-3])$/.exec(controlId);
  if (!match) return undefined;
  const row = Number(match[1]);
  const column = Number(match[2]);
  return (3 - row) * 4 + column;
}
