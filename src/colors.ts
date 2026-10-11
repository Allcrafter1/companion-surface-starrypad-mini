export type RGB = readonly [number, number, number];
export const RGB_ADDRESSES = Array.from(
  { length: 16 },
  (_, pad) => pad * 42 + 5,
);
export function rgbAddress(pad: number): number {
  if (!Number.isInteger(pad) || pad < 0 || pad > 15) throw Error("Invalid pad");
  return RGB_ADDRESSES[pad]!;
}
const equal = (a: RGB | undefined, b: RGB) =>
  a?.every((v, i) => v === b[i]) ?? false;
/** Latest desired color per pad; successfully sent writes become the optimistic dedupe baseline. */
export class Colors {
  private current = new Map<number, RGB>();
  private pending = new Map<number, RGB>();
  seed(pad: number, rgb: RGB): void {
    this.current.set(pad, [...rgb]);
  }
  set(pad: number, rgb: RGB): void {
    rgbAddress(pad);
    if (rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
      throw Error("Invalid RGB");
    this.pending.set(pad, [...rgb]);
  }
  next(): [number, RGB] | undefined {
    for (const [pad, rgb] of this.pending) {
      if (equal(this.current.get(pad), rgb)) this.pending.delete(pad);
      else return [pad, rgb];
    }
    return undefined;
  }
  sent(pad: number, rgb: RGB): void {
    this.seed(pad, rgb);
    if (equal(this.pending.get(pad), rgb)) this.pending.delete(pad);
  }
  clear(): void {
    this.pending.clear();
  }
}
