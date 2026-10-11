# Donner STARRYPAD MINI for Bitfocus Companion

An experimental surface module that turns the 16 pads of the Donner STARRYPAD
MINI into a 4×4 control surface for Bitfocus Companion. Pressing a pad triggers
the assigned Companion button. The rendered button background color is sent to
the corresponding pad as RGB.

## Tested configuration

- Donner STARRYPAD MINI, **firmware 010**
- Linux (CompanionPi on Debian 13) over USB MIDI
- Bitfocus Companion 5.0.7
- Module version 0.2.0

Other firmware versions and operating systems have not been tested yet.

The M-VAVE **SMC-PAD Pocket** and possibly the SZ-STUDIOPAD-MINI appear to be
related hardware. M-VAVE lists all three products as supported by the same
MidiSuite application. They are good candidates for testing, but compatibility
has not been confirmed. This version specifically detects a MIDI port named
`STARRYPAD MINI-Private`.

## Installation

1. Download `starrypad-mini-0.2.0.tgz` from the
   [v0.2.0 release](https://github.com/Allcrafter1/companion-surface-starrypad-mini/releases/tag/v0.2.0).
2. Open the **Modules** page in Companion and select **Import module package**.
3. Import the downloaded `.tgz` file.
4. Open **Surfaces**, select **Add Surface Integration**, and enable the
   STARRYPAD MINI. On a narrow browser window, open **Show Settings** first.
5. Assign a Companion page to the device like any other 4×4 surface.

Companion documents package imports in its [module guide][modules] and adding a
surface in its [surface guide][surfaces].

[modules]: https://github.com/bitfocus/companion/blob/main/docs/user-guide/3_config/modules.md
[surfaces]: https://github.com/bitfocus/companion/blob/main/docs/user-guide/7_surfaces/index.md

The module selects **Preset 1 / Bank 1** automatically when it connects. The
official Windows editor is not required.

## Pad layout

The printed pad numbers run from bottom to top:

| Physical row | Left to right | Default notes on MIDI channel 10 |
| --- | --- | --- |
| Top | Pad 13, 14, 15, 16 | 16, 17, 18, 19 |
| Row 2 | Pad 9, 10, 11, 12 | 12, 13, 14, 15 |
| Row 3 | Pad 5, 6, 7, 8 | 8, 9, 10, 11 |
| Bottom | Pad 1, 2, 3, 4 | 4, 5, 6, 7 |

The Companion controls are arranged spatially from top left to bottom right. A
different MIDI mapping can be entered in the surface settings as exactly 16
`channel:note` entries. Use `-` to disable a control.

## Colors and feedback

Companion renders the final button state, including steps and feedbacks. The
module uses the rendered background color as the pad color. Local steps,
Home Assistant feedbacks, and other Companion feedbacks continue to work. The
device itself briefly turns a pressed pad white before returning to the
Companion color.

On connection, the module reads only the data required for a controlled start:

1. 12 preset and bank selection bytes,
2. 16 internal control-function bytes from Preset 1,
3. 672 bytes from Preset 1 / Bank 1 to seed the color cache.

During normal operation, one real color change produces one three-byte RGB
write. Unchanged colors are skipped, rapid updates to a pad are reduced to the
latest value, and every write is serialized.

The minimum interval is 1 ms and can be increased to 1000 ms. A value of `0` is
rejected because the tested device lost one write during a 16-pad burst without
an interval. Five bursts with a 1 ms interval completed with full readback.
Whether RGB writes are stored only in RAM or also in flash remains unknown.

## Controlled Preset 1 startup

The module manages only Preset 1 / Bank 1:

- Values that are already correct are not written again.
- A required preset or bank change writes only the relevant byte and verifies
  the complete selection data immediately.
- The one precisely known broken Preset 1 control table,
  `0,0,125,255,0,0,0,0,0,0,0,0,6,0,0,0`, is backed up, replaced with 16 zero
  bytes, and verified. Those values assigned internal functions to Pads 3 and 4
  and caused reconnects.
- Any other unknown table is left untouched. Input remains available, while RGB
  is disabled for that session and the reason is logged.

Backups made immediately before a real configuration change use file mode
`0600` and are stored in
`~/.local/state/companion-surface-starrypad-mini/`. Other presets and banks are
not read or modified by the module.

## Diagnostics and bug reports

Log messages contain a short session ID and stable categories:
`[SPM-STATE]`, `[SPM-CONNECT]`, `[SPM-CONFIG]`, `[SPM-PROTOCOL]`,
`[SPM-INPUT]`, `[SPM-RGB]`, `[SPM-PORT]`, and `[SPM-CLOSE]`. Invalid SysEx
frames are reported and rate limited after three individual warnings. Successful
RGB writes are only logged at debug level.

Create a filtered support report from a source checkout with:

```bash
npm ci
npm run diagnostics
```

The resulting text file contains the module revision, basic system, USB and ALSA
status, a short Companion service status, and at most 1000 matching log lines
from the previous 24 hours. It does not collect the Companion database, a device
memory dump, or firmware. Review the file before attaching it to a report.

Tests and bug reports are welcome in
[GitHub Issues](https://github.com/Allcrafter1/companion-surface-starrypad-mini/issues).
Please include the device model, firmware version, operating system, Companion
version, reproduction steps, and preferably the diagnostics report.

## Confirmed tests

- USB MIDI input and proprietary RGB SysEx output tested independently.
- All 16 pads mapped in the correct physical orientation; press and release work.
- Companion steps and feedback colors tested on the real device.
- Automatic Preset 1 / Bank 1 selection and repair of the precisely known broken
  Preset 1 control bytes tested on hardware.
- A single RGB update verified by readback and restored afterward.
- Five complete 16-pad bursts at 1 ms verified by readback and restored.
- Ten Companion restarts reached `ready` ten times.
- Physical unplug and reconnect completed successfully.
- Linux identification was verified against the real unit's USB serial number.
- Synthetic tests cover two uniquely serialized devices, ALSA renumbering,
  duplicate or missing serial numbers, and ambiguous discovery.
- 28 automated protocol, mapping, deduplication, safety, discovery, and race
  tests pass.

## Known limitations

- Practical testing currently covers only the Donner device with firmware 010
  on Linux and Companion 5.0.7.
- M-VAVE SMC-PAD Pocket and SZ-STUDIOPAD-MINI are plausible relatives, but are
  neither detected nor tested yet.
- On Linux, devices with unique USB serial numbers receive separate, stable
  Companion identities. The raw serial number is hashed and is never included
  in the ID or description. A missing or duplicated serial falls back to the
  physical USB port, so reconnecting it to another port creates a new surface.
- Only one physical STARRYPAD MINI was available. Multi-device discovery is
  covered by synthetic tests but still needs confirmation with two real units.
- `@julusian/midi` does not expose the ALSA card number. This version therefore
  pairs matching ALSA clients and USB MIDI cards by their kernel discovery
  order and accepts the result only when every device can be matched one to
  one. If discovery is incomplete or ambiguous, that scan reports no device;
  Companion normally finds it on a later scan after Linux has finished hotplug.
- A manual preset, bank, or editor change during an already validated session is
  corrected on the next reconnect.
- RGB writes are cached optimistically after they are sent. Normal writes have
  no device acknowledgement, so a transport error causes a reconnect instead
  of an unverified retry.
- Multi-day operation, a full host reboot, and other firmware revisions still
  need independent testing.

## Building from source

Use a Node.js version supported by `@companion-surface/base` (`^22.21` or
`^26.5`) and the usual native build tools required by the MIDI package.

```bash
npm ci
npm test
npm run package
```

The result is `starrypad-mini-0.2.0.tgz`, ready for Companion's
**Import module package** function.

Dependabot checks npm dependencies weekly. Minor and patch updates are grouped;
major updates remain separate for explicit review. GitHub Actions dependencies
are checked monthly.

## License

MIT. This is an independent prototype and is not affiliated with Donner,
M-VAVE, or Bitfocus.
