import type {
  SurfacePlugin,
  SurfaceSchemaLayoutDefinition,
} from "@companion-surface/base";
import { Input, Output } from "@julusian/midi/lazy";
import { getInputs, getOutputs } from "./midi-helper.js";
import { resolveLinuxDeviceIdentities } from "./linux-device.js";
import { StarryPad } from "./instance.js";
import { DEFAULT_NOTES } from "./mapping.js";
interface Device {
  input: string;
  output: string;
}
export const matchesPort = (name: string): boolean =>
  /(?:^|[\s:])STARRYPAD MINI-Private(?:\s+\d+(?::\d+)?)?$/i.test(name);
export const stableSurfaceId = (name: string): string =>
  `starrypad-mini:${name.replace(/\s+\d+:\d+$/, "")}`;
const layout: SurfaceSchemaLayoutDefinition = {
  stylePresets: { default: { colors: "hex" } },
  controls: Object.fromEntries(
    Array.from({ length: 16 }, (_, pad) => [
      `${Math.floor(pad / 4)}/${pad % 4}`,
      { row: Math.floor(pad / 4), column: pad % 4 },
    ]),
  ),
};
const plugin: SurfacePlugin<Device> = {
  init: async () => {},
  destroy: async () => {},
  scanForSurfaces: async () => {
    const outputs = getOutputs();
    const inputs = getInputs().filter(matchesPort);
    const linuxIdentities = await resolveLinuxDeviceIdentities(inputs);
    // During hotplug ALSA can become visible before sysfs is complete. Waiting
    // for the next scan avoids creating a second, temporary name-based surface.
    if (process.platform === "linux" && linuxIdentities.size !== inputs.length)
      return [];
    return inputs
      .flatMap((input) => {
        const output = outputs.find((n) => n === input);
        const identity = linuxIdentities.get(input);
        return output
          ? [
              {
                deviceHandle: `starrypad-mini:${input}`,
                surfaceId: identity?.surfaceId ?? stableSurfaceId(input),
                description: identity
                  ? `${input} (${identity.description})`
                  : input,
                pluginInfo: { input, output },
              },
            ]
          : [];
      });
  },
  openSurface: async (surfaceId, device, context) => {
    const input = new Input(),
      output = new Output();
    try {
      const i = getInputs().indexOf(device.input),
        o = getOutputs().indexOf(device.output);
      if (i < 0 || o < 0) throw Error("STARRYPAD MINI port missing");
      input.openPort(i);
      output.openPort(o);
      return {
        surface: new StarryPad(
          surfaceId,
          input,
          output,
          device.input,
          device.output,
          context,
        ),
        registerProps: {
          brightness: false,
          canChangePage: undefined,
          surfaceLayout: layout,
          pincodeMap: null,
          location: null,
          configFields: [
            {
              id: "notes",
              type: "textinput",
              label:
                "Top-left to bottom-right: 16 channel:note entries (- = disabled)",
              default: DEFAULT_NOTES,
            },
            {
              id: "rgbIntervalMs",
              type: "number",
              label: "RGB interval in ms (measured default 1)",
              default: 1,
              min: 1,
              max: 1000,
              step: 1,
            },
          ],
        },
      };
    } catch (e) {
      try {
        input.closePort();
      } catch {}
      try {
        input.destroy();
      } catch {}
      try {
        output.closePort();
      } catch {}
      try {
        output.destroy();
      } catch {}
      throw e;
    }
  },
};
export default plugin;
