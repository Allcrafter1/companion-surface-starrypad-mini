import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const USB_VENDOR = "4353";
const USB_PRODUCT = "4b4d";

export interface LinuxUsbMidiDevice {
  card: number;
  device: number;
  serial?: string;
  usbPath: string;
}

export interface LinuxDeviceIdentity {
  surfaceId: string;
  description: string;
  source: "serial" | "usb-path";
}

interface AlsaPort {
  name: string;
  client: number;
  port: number;
}

export function parseAlsaPort(name: string): AlsaPort | undefined {
  const match = /\s(\d+):(\d+)$/.exec(name);
  if (!match) return undefined;
  return { name, client: Number(match[1]), port: Number(match[2]) };
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

/**
 * Match ALSA sequencer clients to USB MIDI cards.
 *
 * ALSA creates both in discovery order, but node-midi currently exposes no
 * card number. Refuse the heuristic unless every target port and card can be
 * paired one-to-one. See the upstream node-midi metadata request documented
 * in the README.
 */
export function matchLinuxDeviceIdentities(
  portNames: readonly string[],
  devices: readonly LinuxUsbMidiDevice[],
): Map<string, LinuxDeviceIdentity> {
  const ports = portNames
    .map(parseAlsaPort)
    .filter((port): port is AlsaPort => port !== undefined)
    .sort((a, b) => a.client - b.client || a.port - b.port);
  const cards = [...devices].sort(
    (a, b) => a.card - b.card || a.device - b.device,
  );

  if (ports.length === 0 || ports.length !== portNames.length) return new Map();
  if (cards.length !== ports.length) return new Map();

  const serialCounts = new Map<string, number>();
  for (const card of cards) {
    if (card.serial)
      serialCounts.set(card.serial, (serialCounts.get(card.serial) ?? 0) + 1);
  }

  return new Map(
    ports.map((port, index) => {
      const card = cards[index];
      const uniqueSerial =
        card.serial && serialCounts.get(card.serial) === 1
          ? card.serial
          : undefined;
      const source = uniqueSerial ? "serial" : "usb-path";
      const rawIdentity = uniqueSerial ?? card.usbPath;
      const token = fingerprint(rawIdentity);
      const description = uniqueSerial
        ? `USB device ${token.slice(0, 8)}`
        : `USB port ${card.usbPath}`;
      return [
        port.name,
        {
          surfaceId: `starrypad-mini:linux-${source}:${token}`,
          description,
          source,
        },
      ];
    }),
  );
}

async function readTrimmed(path: string): Promise<string | undefined> {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export async function scanLinuxUsbMidiDevices(
  soundClassPath = "/sys/class/sound",
): Promise<LinuxUsbMidiDevice[]> {
  let entries: string[];
  try {
    entries = await readdir(soundClassPath);
  } catch {
    return [];
  }

  const devices: LinuxUsbMidiDevice[] = [];
  for (const entry of entries) {
    const match = /^midiC(\d+)D(\d+)$/.exec(entry);
    if (!match) continue;
    try {
      const usbInterface = await realpath(
        join(soundClassPath, entry, "device", "device"),
      );
      const usbDevice = dirname(usbInterface);
      const vendor = await readTrimmed(join(usbDevice, "idVendor"));
      const product = await readTrimmed(join(usbDevice, "idProduct"));
      if (vendor?.toLowerCase() !== USB_VENDOR) continue;
      if (product?.toLowerCase() !== USB_PRODUCT) continue;
      devices.push({
        card: Number(match[1]),
        device: Number(match[2]),
        serial: await readTrimmed(join(usbDevice, "serial")),
        usbPath: basename(usbDevice),
      });
    } catch {
      // Ignore unrelated or partially disconnected sound devices.
    }
  }
  return devices;
}

export async function resolveLinuxDeviceIdentities(
  portNames: readonly string[],
  soundClassPath?: string,
): Promise<Map<string, LinuxDeviceIdentity>> {
  if (process.platform !== "linux") return new Map();
  return matchLinuxDeviceIdentities(
    portNames,
    await scanLinuxUsbMidiDevices(soundClassPath),
  );
}
