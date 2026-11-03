// Right column: the inspector (printer, filament, preset, process tabs and the tabs of the plugins turned on in the
// Plugins menu). Its left edge has a grip: drag it to widen or narrow the column; double-click resets it.
import { useEffect, useState } from 'react';
import { Inspector } from '../inspector/Inspector';

const LS = 'nexspiro.rightWidth';
const MIN = 300, DEF = 360;
const read = () => { try { const v = Number(localStorage.getItem(LS)); return v >= MIN ? v : DEF; } catch { return DEF; } };
let width = read();
const subs = new Set<(w: number) => void>();
const setWidth = (w: number) => { width = w; subs.forEach((f) => f(w)); try { localStorage.setItem(LS, String(Math.round(w))); } catch { /* storage off */ } };

/** Current right-column width in px (the app grid uses it). */
export function useRightWidth() {
  const [w, set] = useState(width);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return w;
}

export function RightColumn() {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    const x0 = e.clientX, w0 = width;
    const max = () => Math.max(MIN, window.innerWidth / zoom * 0.6);
    const move = (ev: PointerEvent) => setWidth(Math.min(max(), Math.max(MIN, w0 + (x0 - ev.clientX) / zoom)));
    const up = () => { document.body.classList.remove('sh-resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    document.body.classList.add('sh-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <aside className="sh-right" aria-label="Inspector">
      <div className="sh-grip" role="separator" aria-orientation="vertical" aria-label="Resize the settings column"
        title="Drag to resize · double-click to reset" onPointerDown={start} onDoubleClick={() => setWidth(DEF)}><span /></div>
      <div className="sh-inspector"><Inspector /></div>
    </aside>
  );
}
