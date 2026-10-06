// Theme engine: the CSS tokens (tokens.css) drive the DOM; this module drives the Three.js scene so
// both follow the same light/dark switch. No DOM access at import time (safe to unit-test in Node).
export type ThemeMode = "light" | "dark";
const KEY = "nexspiro.theme";

export function initialTheme(): ThemeMode {
  try { const s = localStorage.getItem(KEY); if (s === "light" || s === "dark") return s; } catch { /* storage unavailable */ }
  try { if (matchMedia("(prefers-color-scheme: dark)").matches) return "dark"; } catch { /* no matchMedia */ }
  return "light";
}
export function setThemeAttr(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
}

/** 3D scene colours (hex ints for THREE.Color). Accent hues match tokens.css. */
export type Palette3D = {
  bedFill: number; bedGrid: number; bedEdge: number; bedActive: number; bedLocked: number; exclude: number;
  ring: number; ringSel: number; pathBase: number; pathSel: number; shadow: string;
};
export const PALETTE_3D: Record<ThemeMode, Palette3D> = {
  light: { bedFill: 0xF8F6F1, bedGrid: 0xE3DFD6, bedEdge: 0xC9C3B7, bedActive: 0x7EA8BE, bedLocked: 0xD2A57C, exclude: 0xE2856E,
    ring: 0xD0CABD, ringSel: 0x5E94B0, pathBase: 0x5A5750, pathSel: 0xC9803A, shadow: "rgba(110,98,84," },
  dark: { bedFill: 0x2D3036, bedGrid: 0x383C44, bedEdge: 0x4B505B, bedActive: 0x86B1C7, bedLocked: 0xB58B64, exclude: 0xE8917A,
    ring: 0x555C69, ringSel: 0x9CC2D6, pathBase: 0xE6E2D8, pathSel: 0xF2C779, shadow: "rgba(0,0,0," },
};
/** Paint-region colours: sky, coral, sage, amber, violet, teal, rose. */
export const REGION_COLORS = [0x7EA8BE, 0xE2856E, 0x7DAA92, 0xD9A55B, 0x8A79B8, 0x5FB3B3, 0xC97B96];
export const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
