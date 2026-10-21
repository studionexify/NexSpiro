# Multi-material: filament units, tool changers, manual swaps

How a printer changes filament is a printer setting (*Printer settings → Basic information → Multi-material*), so any printer can be set up for it:

| Kind | Printers | A change is |
| --- | --- | --- |
| Filament unit, one nozzle | Bambu AMS / AMS lite, MMU, CFS, ACE | Cut, unload, load, purge (`[flush_length]`), prime tower if on. ~60–95 s. |
| Tool changer / IDEX | Prusa XL (5 heads), Snapmaker U1 (4), Klipper tool changers, IDEX | A head swap (`T[next_extruder]`). The new head is already loaded: no purge, only a small prime. ~5–12 s. |
| Manual | Single-nozzle printers | A pause (`M600`) for a spool swap. |

## Tool changer settings

- **Toolheads:** filament slot n prints with head n (T0, T1, …). The slicer warns when a print uses more slots than heads.
- **Prime after pick-up (mm³):** replaces what oozed while the head was parked (`[flush_length]`, or the prime tower).
- **Parked head temperature:** a parked head waits this far below its print temperature (`M104 T<n> S…` right after it is parked).
- **Preheat before pick-up (s):** the parked head is heated back to print temperature this long before it is picked up again, from the move-time estimate, so the swap doesn't wait.
- **Time per change:** used for the time estimate.

## What it means for wall art

- **Weave:** each colour has its own head, so a change every layer costs a head swap instead of a purge. The A1 bleed calibration ring takes 2.0 h; the same ring on a two-head U1 profile takes 0.9 h. Colours are limited by heads (up to 16) instead of AMS slots.
- **Velocity paint and lace:** one filament, so they print the same on every printer.

The bundled tool-changer profiles use a generic `T[next_extruder]` change; check their start G-code against the maker's own slicer profile before the first print.
