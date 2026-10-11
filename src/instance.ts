import {
  createModuleLogger,
  parseColor,
  type SurfaceInstance,
  type SurfaceContext,
  type SurfaceDrawProps,
  type HostCapabilities,
  type CardGenerator,
} from "@companion-surface/base";
import type { Input, Output } from "@julusian/midi/lazy";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { packet, read, write, FrameStream, readResponse } from "./sysex.js";
import { selectPresetOne } from "./selection.js";
import { Colors, rgbAddress } from "./colors.js";
import { parseNotes, DEFAULT_NOTES, controlIdToHardwarePad } from "./mapping.js";
import { getInputs, getOutputs } from "./midi-helper.js";
import {
  classifyControlFlags,
  NORMAL_CONTROL_FLAGS,
  P1_BANK_SIZE,
  P1_CONTROL_FLAGS_ADDRESS,
  P1_CONTROL_FLAGS_COUNT,
} from "./configuration.js";

type State =
  | "opening"
  | "discovering"
  | "validating"
  | "repairing"
  | "ready"
  | "degraded"
  | "closing"
  | "disconnected";

export class StarryPad implements SurfaceInstance {
  readonly productName = "STARRYPAD MINI";
  private logger = createModuleLogger("STARRYPAD MINI");
  private colors = new Colors();
  private notes = parseNotes(DEFAULT_NOTES);
  private stream = new FrameStream();
  private readonly session = randomUUID().slice(0, 8);
  private state: State = "opening";
  private stopped = false;
  private safe = false;
  private busy = false;
  private rgbIntervalMs = 1;
  private warnedInvalidInterval = false;
  private invalidFrameWarnings = 0;
  private lastRgbSend = 0;
  private interval: NodeJS.Timeout | undefined;
  private pressed = new Set<string>();
  private pending:
    | {
        region: number;
        address: number;
        count: number;
        resolve: (b: Buffer) => void;
        reject: (e: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  constructor(
    readonly surfaceId: string,
    private input: Input,
    private output: Output,
    private inputName: string,
    private outputName: string,
    private context: SurfaceContext,
  ) {}

  private transition(next: State, detail = ""): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.logger.info(
      `[SPM-STATE] session=${this.session} ${previous}->${next}${detail ? ` ${detail}` : ""}`,
    );
  }

  private logInvalidFrame(error: unknown): void {
    this.invalidFrameWarnings++;
    if (this.invalidFrameWarnings <= 3) {
      this.logger.warn(
        `[SPM-PROTOCOL] session=${this.session} invalid-frame ${String(error)}`,
      );
    } else if (this.invalidFrameWarnings === 4) {
      this.logger.warn(
        `[SPM-PROTOCOL] session=${this.session} further-invalid-frames-suppressed`,
      );
    }
  }

  private send(bytes: number[]): void {
    if (this.stopped) throw Error("Session closed");
    this.output.sendMessage(bytes);
  }

  private async readOnce(
    region: number,
    address: number,
    count: number,
  ): Promise<Buffer> {
    if (this.pending) throw Error("Concurrent read");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(Error(`Read timeout: region=${region} address=${address} count=${count}`));
      }, 2000);
      this.pending = { region, address, count, resolve, reject, timer };
      try {
        this.send(read(region, address, count));
      } catch (e) {
        clearTimeout(timer);
        this.pending = undefined;
        reject(e instanceof Error ? e : Error(String(e)));
      }
    });
  }

  private async read(
    region: number,
    address: number,
    count: number,
  ): Promise<Buffer> {
    let firstError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.readOnce(region, address, count);
      } catch (e) {
        firstError ??= e;
        if (attempt === 2 || this.stopped) break;
        this.logger.warn(
          `[SPM-PROTOCOL] session=${this.session} read-retry region=${region} address=${address} count=${count}`,
        );
        await delay(50);
      }
    }
    throw firstError instanceof Error ? firstError : Error(String(firstError));
  }

  private stateDir(): string {
    return join(
      homedir(),
      ".local",
      "state",
      "companion-surface-starrypad-mini",
    );
  }

  private async saveBeforeChange(prefix: string, data: Buffer): Promise<string> {
    const dir = this.stateDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${prefix}-${Date.now()}.bin`);
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    this.logger.info(
      `[SPM-CONFIG] session=${this.session} backup=${path} bytes=${data.length}`,
    );
    return path;
  }

  async init(): Promise<void> {
    this.input.ignoreTypes(false, true, true);
    this.input.on("message", (_delta, bytes) => {
      for (const frame of this.stream.push(bytes, (error) =>
        this.logInvalidFrame(error),
      )) {
        try {
          const response = readResponse(frame);
          const pending = this.pending;
          if (
            response &&
            pending &&
            response.region === pending.region &&
            response.address === pending.address &&
            response.data.length === pending.count
          ) {
            clearTimeout(pending.timer);
            this.pending = undefined;
            pending.resolve(response.data);
          }
        } catch (e) {
          this.logInvalidFrame(e);
        }
      }
    });
    this.input.on("noteon", (note, velocity, info) =>
      this.note(info.channel, note, velocity > 0),
    );
    this.input.on("noteoff", (note, _velocity, info) =>
      this.note(info.channel, note, false),
    );
    this.interval = setInterval(() => {
      try {
        if (
          !this.input.isPortOpen() ||
          !this.output.isPortOpen() ||
          !getInputs().includes(this.inputName) ||
          !getOutputs().includes(this.outputName)
        )
          this.fail("SPM-PORT", Error("MIDI port lost; reconnect required"));
      } catch (e) {
        this.fail("SPM-PORT", e);
      }
    }, 2000);

    try {
      this.transition("discovering");
      this.send(packet(0x11));
      await delay(180);
      if (this.stopped) return;
      this.transition("validating");

      await selectPresetOne(
        () => this.readOnce(4, 0, 12),
        (metadata) =>
          this.saveBeforeChange("region4-before-selection", metadata).then(
            () => undefined,
          ),
        async (address, value) => {
          this.send(write(4, address, Uint8Array.of(value)));
          await delay(50);
        },
      );
      if (this.stopped) return;

      let flags = await this.read(
        5,
        P1_CONTROL_FLAGS_ADDRESS,
        P1_CONTROL_FLAGS_COUNT,
      );
      if (this.stopped) return;
      const flagStatus = classifyControlFlags(flags);
      if (flagStatus === "known-bad") {
        this.transition("repairing", "known-control-flags");
        await this.saveBeforeChange("p1-control-flags-before-repair", flags);
        if (this.stopped) return;
        flags = await this.readOnce(
          5,
          P1_CONTROL_FLAGS_ADDRESS,
          P1_CONTROL_FLAGS_COUNT,
        );
        if (this.stopped) return;
        const currentStatus = classifyControlFlags(flags);
        if (currentStatus === "known-bad") {
          this.send(write(5, P1_CONTROL_FLAGS_ADDRESS, NORMAL_CONTROL_FLAGS));
          await delay(50);
          if (this.stopped) return;
          flags = await this.readOnce(
            5,
            P1_CONTROL_FLAGS_ADDRESS,
            P1_CONTROL_FLAGS_COUNT,
          );
          if (this.stopped) return;
          if (classifyControlFlags(flags) !== "normal")
            throw Error("Preset 1 control flag repair readback mismatch");
          this.logger.info(
            `[SPM-CONFIG] session=${this.session} repaired=P1-control-flags bytes=16 verified=true`,
          );
        } else if (currentStatus === "normal") {
          this.logger.info(
            `[SPM-CONFIG] session=${this.session} repair-skipped flags-changed-to-normal`,
          );
        } else {
          this.safe = false;
          this.colors.clear();
          this.transition("degraded", "control-flags-changed-before-repair");
          this.logger.error(
            `[SPM-CONFIG] session=${this.session} code=CONTROL_FLAG_RACE preset=1 rgb=disabled`,
          );
          return;
        }
      } else if (flagStatus === "unknown") {
        this.safe = false;
        this.colors.clear();
        this.transition("degraded", "unknown-control-flags");
        this.logger.error(
          `[SPM-CONFIG] session=${this.session} code=CONTROL_FLAG_UNKNOWN preset=1 values=${flags.toString("hex")} rgb=disabled`,
        );
        return;
      }

      const bank = await this.read(5, 0, P1_BANK_SIZE);
      if (this.stopped) return;
      for (let pad = 0; pad < 16; pad++) {
        const address = rgbAddress(pad);
        this.colors.seed(pad, [
          bank[address]!,
          bank[address + 1]!,
          bank[address + 2]!,
        ]);
      }

      this.safe = true;
      this.transition("ready", `rgbIntervalMs=${this.rgbIntervalMs}`);
      this.logger.info(
        `[SPM-CONNECT] session=${this.session} preset=1 bank=1 flags=normal cache=seeded`,
      );
      void this.flush();
    } catch (e) {
      if (!this.stopped) this.fail("SPM-CONNECT", e);
    }
  }

  private note(channel: number, note: number, down: boolean): void {
    const id = this.notes.get(channel * 128 + note);
    if (!id) return;
    this.logger.debug(
      `[SPM-INPUT] session=${this.session} channel=${channel + 1} note=${note} ${down ? "down" : "up"} control=${id}`,
    );
    try {
      if (down) {
        if (this.pressed.has(id)) return;
        this.context.keyDownById(id);
        this.pressed.add(id);
      } else {
        if (!this.pressed.delete(id)) return;
        this.context.keyUpById(id);
      }
    } catch (e) {
      this.pressed.delete(id);
      this.fail("SPM-INPUT", e);
    }
  }

  private releasePressed(): void {
    for (const id of this.pressed) {
      try {
        this.context.keyUpById(id);
      } catch (e) {
        this.logger.warn(
          `[SPM-INPUT] session=${this.session} release-failed control=${id} ${String(e)}`,
        );
      }
    }
    this.pressed.clear();
  }

  private fail(code: string, value: unknown): void {
    if (this.stopped) return;
    const error = value instanceof Error ? value : Error(String(value));
    this.safe = false;
    this.colors.clear();
    this.logger.error(
      `[${code}] session=${this.session} state=${this.state} ${error.message}`,
    );
    void this.close().then(() => {
      try {
        this.context.disconnect(error);
      } catch (e) {
        this.logger.error(
          `[SPM-CLOSE] session=${this.session} disconnect-callback ${String(e)}`,
        );
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.busy || !this.safe || this.stopped) return;
    this.busy = true;
    try {
      while (this.safe && !this.stopped) {
        const next = this.colors.next();
        if (!next) break;
        let [pad, rgb] = next;
        const wait = this.rgbIntervalMs - (performance.now() - this.lastRgbSend);
        if (wait > 0) await delay(wait);
        if (!this.safe || this.stopped) break;
        const latest = this.colors.next();
        if (!latest) continue;
        [pad, rgb] = latest;
        this.send(write(5, rgbAddress(pad), Uint8Array.from(rgb)));
        this.lastRgbSend = performance.now();
        this.colors.sent(pad, rgb);
        this.logger.debug(
          `[SPM-RGB] session=${this.session} pad=${pad + 1} value=${rgb.join(",")} sent=true verified=false`,
        );
      }
    } catch (e) {
      this.fail("SPM-RGB", e);
    } finally {
      this.busy = false;
    }
  }

  async draw(signal: AbortSignal, props: SurfaceDrawProps): Promise<void> {
    if (signal.aborted || this.stopped || !props.color) return;
    const hardwarePad = controlIdToHardwarePad(props.controlId);
    if (hardwarePad === undefined) return;
    const color = parseColor(props.color);
    this.colors.set(hardwarePad, [color.r, color.g, color.b]);
    void this.flush();
  }

  async updateConfig(config: Record<string, unknown>): Promise<void> {
    try {
      const notes = parseNotes(
        typeof config.notes === "string" ? config.notes : DEFAULT_NOTES,
      );
      const changed =
        notes.size !== this.notes.size ||
        [...notes].some(([key, value]) => this.notes.get(key) !== value);
      if (changed) {
        this.releasePressed();
      }
      this.notes = notes;
    } catch (e) {
      this.releasePressed();
      this.notes.clear();
      this.logger.warn(`[SPM-CONFIG] invalid-note-map ${String(e)}`);
    }
    const rawInterval =
      typeof config.rgbIntervalMs === "string"
        ? config.rgbIntervalMs.trim()
        : String(config.rgbIntervalMs ?? "1");
    const interval = Number(rawInterval);
    if (Number.isInteger(interval) && interval >= 1 && interval <= 1000) {
      this.rgbIntervalMs = interval;
      this.warnedInvalidInterval = false;
    } else {
      this.rgbIntervalMs = 1;
      if (!this.warnedInvalidInterval) {
        this.warnedInvalidInterval = true;
        this.logger.warn(
          `[SPM-CONFIG] invalid-rgb-interval value=${JSON.stringify(rawInterval)} fallback=1`,
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.safe = false;
    this.transition("closing");
    this.colors.clear();
    clearInterval(this.interval);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error("Session closed"));
      this.pending = undefined;
    }
    this.releasePressed();
    this.input.removeAllListeners();
    try {
      this.input.closePort();
    } catch (e) {
      this.logger.warn(`[SPM-CLOSE] input-close ${String(e)}`);
    }
    try {
      this.input.destroy();
    } catch (e) {
      this.logger.warn(`[SPM-CLOSE] input-destroy ${String(e)}`);
    }
    try {
      this.output.closePort();
    } catch (e) {
      this.logger.warn(`[SPM-CLOSE] output-close ${String(e)}`);
    }
    try {
      this.output.destroy();
    } catch (e) {
      this.logger.warn(`[SPM-CLOSE] output-destroy ${String(e)}`);
    }
    this.transition("disconnected");
  }

  updateCapabilities(_capabilities: HostCapabilities): void {}
  async ready(): Promise<void> {}
  async setBrightness(_percent: number): Promise<void> {}
  async blank(): Promise<void> {
    /* Preserve pad state: Companion redraws when needed. */
  }
  async showStatus(
    _signal: AbortSignal,
    _card: CardGenerator,
    _message: string,
  ): Promise<void> {}
}
