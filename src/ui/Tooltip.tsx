// Instant tooltips: any element with a title shows it the moment the pointer enters, instead of
// after the browser's built-in delay. The title is moved to data-tip so the native one never appears.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Tip { text: string; r: DOMRect }

export function InstantTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cur: HTMLElement | null = null;
    const show = (el: HTMLElement | null) => {
      cur = el;
      if (!el) { setTip(null); return; }
      const t = el.getAttribute('title');
      if (t) { el.dataset.tip = t; el.removeAttribute('title'); }
      const text = el.dataset.tip;
      setTip(text ? { text, r: el.getBoundingClientRect() } : null);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title],[data-tip]') as HTMLElement | null;
      if (el !== cur) show(el);
    };
    const out = (e: PointerEvent) => { if (!e.relatedTarget) show(null); };
    const hide = () => show(null);
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  // below the element, centred; above it when there is no room; kept inside the window
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth, h = el.offsetHeight, { r } = tip;
    const x = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6));
    const y = r.bottom + 6 + h > innerHeight - 4 ? r.top - h - 6 : r.bottom + 6;
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(4, y)}px`;
    el.style.visibility = 'visible';
  }, [tip]);
  if (!tip) return null;
  return <div ref={box} className="instant-tip" role="tooltip" style={{ visibility: 'hidden' }}>{tip.text}</div>;
}
