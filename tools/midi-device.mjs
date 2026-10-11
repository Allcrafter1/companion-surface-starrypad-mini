import { Input, Output } from "@julusian/midi/lazy";
import { setTimeout as delay } from "node:timers/promises";
import { getInputs, getOutputs } from "../dist/midi-helper.js";
import {
  packet,
  read as readPacket,
  write as writePacket,
  FrameStream,
  readResponse,
} from "../dist/sysex.js";

function findPrivatePort(names) {
  return names.findIndex((name) =>
    /(?:^|[\s:])STARRYPAD MINI-Private(?:\s+\d+(?::\d+)?)?$/i.test(name),
  );
}

export function openPrivateDevice() {
  const inputNames = getInputs();
  const outputNames = getOutputs();
  const inputIndex = findPrivatePort(inputNames);
  if (inputIndex < 0) throw Error("STARRYPAD MINI Private MIDI input not found");
  const name = inputNames[inputIndex];
  const outputIndex = outputNames.findIndex((candidate) => candidate === name);
  if (outputIndex < 0)
    throw Error("Matching STARRYPAD MINI Private MIDI output not found");
  const input = new Input();
  const output = new Output();
  input.openPort(inputIndex);
  try {
    output.openPort(outputIndex);
  } catch (error) {
    input.closePort();
    input.destroy();
    throw error;
  }
  return { input, output, name };
}

export class ProtocolClient {
  #stream = new FrameStream();
  #pending;
  #closed = false;

  constructor(input, output) {
    this.input = input;
    this.output = output;
  }

  async start() {
    this.input.ignoreTypes(false, true, true);
    this.input.on("message", (_delta, bytes) => {
      for (const frame of this.#stream.push(bytes, (error) =>
        console.warn(`Ignored invalid SysEx frame: ${String(error)}`),
      )) {
        try {
          const response = readResponse(frame);
          const pending = this.#pending;
          if (
            response &&
            pending &&
            response.region === pending.region &&
            response.address === pending.address &&
            response.data.length === pending.count
          ) {
            clearTimeout(pending.timer);
            this.#pending = undefined;
            pending.resolve(response.data);
          }
        } catch (error) {
          console.warn(`Ignored invalid SysEx response: ${String(error)}`);
        }
      }
    });
    this.send(packet(0x11));
    await delay(180);
  }

  send(bytes) {
    if (this.#closed) throw Error("Protocol client closed");
    this.output.sendMessage(bytes);
  }

  async read(region, address, count) {
    if (this.#pending) throw Error("Concurrent read");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = undefined;
        reject(Error(`Read timeout: region=${region} address=${address} count=${count}`));
      }, 2000);
      this.#pending = { region, address, count, resolve, reject, timer };
      try {
        this.send(readPacket(region, address, count));
      } catch (error) {
        clearTimeout(timer);
        this.#pending = undefined;
        reject(error);
      }
    });
  }

  write(region, address, data) {
    this.send(writePacket(region, address, data));
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(Error("Protocol client closed"));
      this.#pending = undefined;
    }
    this.input.removeAllListeners();
    try {
      this.input.closePort();
    } catch {}
    try {
      this.input.destroy();
    } catch {}
    try {
      this.output.closePort();
    } catch {}
    try {
      this.output.destroy();
    } catch {}
  }
}
