/** Firmware 010: continuous little-endian bit packing (not MSB buckets). */
export function checksum(data: Uint8Array): number {
  return ~data.reduce((a, b) => a + b, 0) & 255;
}
export function packet(
  command: number,
  data: Uint8Array = new Uint8Array(),
): number[] {
  const raw = Buffer.alloc(data.length + 7);
  raw.set([0, 0x59, command]);
  raw.writeUIntLE(data.length, 3, 3);
  raw.set(data, 6);
  raw[raw.length - 1] = checksum(data);
  let acc = 0,
    bits = 0;
  const out = [0xf0];
  for (const b of raw) {
    acc |= b << bits;
    bits += 8;
    while (bits >= 7) {
      out.push(acc & 127);
      acc >>>= 7;
      bits -= 7;
    }
  }
  if (bits) out.push(acc & 127);
  out.push(0xf7);
  return out;
}
function header(region: number, address: number, count: number): Buffer {
  const b = Buffer.alloc(8);
  b[0] = region;
  b.writeUInt32LE(address, 1);
  b.writeUIntLE(count, 5, 3);
  return b;
}
export function read(region: number, address: number, count: number): number[] {
  return packet(0x23, header(region, address, count));
}
export function write(
  region: number,
  address: number,
  data: Uint8Array,
): number[] {
  return packet(
    0x22,
    Buffer.concat([header(region, address, data.length), data]),
  );
}
export interface Frame {
  command: number;
  data: Buffer;
}
export function decode(frame: readonly number[]): Frame {
  if (frame[0] !== 0xf0 || frame.at(-1) !== 0xf7)
    throw Error("Invalid framing");
  let acc = 0,
    bits = 0;
  const raw: number[] = [];
  for (const b of frame.slice(1, -1)) {
    if (!Number.isInteger(b) || b < 0 || b > 127)
      throw Error("Non MIDI-safe byte");
    acc |= b << bits;
    bits += 7;
    while (bits >= 8) {
      raw.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  }
  const b = Buffer.from(raw);
  if (b.length < 7 || b[0] !== 0 || b[1] !== 0x59)
    throw Error("Unknown header");
  const n = b.readUIntLE(3, 3);
  if (
    b.length !== n + 7 ||
    frame.length !== Math.ceil(((n + 7) * 8) / 7) + 2 ||
    acc !== 0
  )
    throw Error("Invalid length or padding");
  const data = b.subarray(6, -1);
  if (checksum(data) !== b.at(-1)) throw Error("Checksum mismatch");
  return { command: b[2]!, data };
}
export function readResponse(
  f: Frame,
): { region: number; address: number; data: Buffer } | undefined {
  if (f.command !== 0x23) return;
  if (f.data.length < 8) throw Error("Truncated read response");
  const n = f.data.readUIntLE(5, 3);
  if (n !== f.data.length - 8) throw Error("Read count mismatch");
  return {
    region: f.data[0]!,
    address: f.data.readUInt32LE(1),
    data: f.data.subarray(8),
  };
}
/** Handles fragmented/concatenated frames, MIDI real-time interleaving, and resynchronisation. */
export class FrameStream {
  private bytes: number[] = [];
  push(
    bytes: readonly number[],
    onInvalidFrame?: (error: unknown) => void,
  ): Frame[] {
    const frames: Frame[] = [];
    for (const b of bytes) {
      if (b >= 0xf8) continue;
      if (b === 0xf0) {
        this.bytes = [b];
        continue;
      }
      if (!this.bytes.length) continue;
      if (b === 0xf7) {
        this.bytes.push(b);
        try {
          frames.push(decode(this.bytes));
        } catch (error) {
          onInvalidFrame?.(error);
        }
        this.bytes = [];
      } else if (b >= 128 || this.bytes.length > 32768) this.bytes = [];
      else this.bytes.push(b);
    }
    return frames;
  }
}
