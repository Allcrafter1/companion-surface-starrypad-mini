export const P1_BANK_SIZE = 672;
export const P1_CONTROL_FLAGS_ADDRESS = 4704;
export const P1_CONTROL_FLAGS_COUNT = 16;
export const NORMAL_CONTROL_FLAGS = Buffer.alloc(P1_CONTROL_FLAGS_COUNT);
export const KNOWN_BAD_CONTROL_FLAGS = Buffer.from([
  0, 0, 125, 255, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0,
]);

export type ControlFlagStatus = "normal" | "known-bad" | "unknown";

export function classifyControlFlags(flags: Uint8Array): ControlFlagStatus {
  if (flags.length !== P1_CONTROL_FLAGS_COUNT) return "unknown";
  const value = Buffer.from(flags);
  if (value.equals(NORMAL_CONTROL_FLAGS)) return "normal";
  if (value.equals(KNOWN_BAD_CONTROL_FLAGS)) return "known-bad";
  return "unknown";
}
