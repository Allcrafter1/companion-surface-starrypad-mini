# Changelog

## 0.2.0 – 2026-10-11

- Added stable per-device Linux identities based on hashed USB serial numbers.
- Added a physical USB port fallback for missing or duplicated serial numbers.
- Added synthetic coverage for two devices, ALSA renumbering, identity
  collisions, and ambiguous discovery.
- Incomplete Linux hotplug discovery waits for a later scan instead of creating
  a temporary name-based surface.

## 0.1.0 – 2026-10-11

Initial experimental release:

- 4×4 pad input for Companion.
- RGB output from the rendered button background color.
- Automatic, verified Preset 1 / Bank 1 selection.
- Targeted repair of the precisely known broken P1 control bytes.
- RGB deduplication, serialization, and a configurable minimum interval.
- Stable single-device surface identity across changing ALSA client numbers.
- Session-based reconnect, race, and protocol diagnostics.

Tested with Donner STARRYPAD MINI firmware 010 on CompanionPi (Debian 13) and
Companion 5.0.7.
