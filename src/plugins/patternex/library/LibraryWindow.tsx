// Patternex library window (98% of the screen): browse thousands of generated patterns by type,
// edit any of them with sliders, preview it on the chosen face / side / whole body, then apply.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../../state/store';
import { CATEGORIES, familyById, type Category } from './families';
import { buildPattern, libraryCounts, paletteOf, PALETTES, patternSvg, searchLibrary, specOf, type GenSpec, type LibraryEntry } from './catalog';
import { applyToObject, SIDES, targetObject, targetSize, type Side, type Target } from './apply';
import { px, changed } from '../ui/PatternexPanel';
import { addPattern } from '../ui/state';

const PAGE = 120;
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// thumbnails are built lazily, a few per frame, and cached by entry key
const thumbCache = new Map<string, string>();
const queue: { key: string; run: () => void }[] = [];
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) queue.shift()!.run();
    if (queue.length) requestAnimationFrame(step); else pumping = false;
  };
  requestAnimationFrame(step);
}

function Thumb({ e, on, onPick }: { e: LibraryEntry; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState(thumbCache.get(e.key) ?? '');
  useEffect(() => {
    if (src) return;
    const el = ref.current!;
    let job: { key: string; run: () => void } | null = null;
    const io = new IntersectionObserver(([hit]) => {
      if (!hit.isIntersecting || job) return;
      job = { key: e.key, run: () => {
        const pat = buildPattern(specOf(e));
        const url = svgUrl(patternSvg(pat, 40, 40, paletteOf(e.palette).colors[0], 8000));
        thumbCache.set(e.key, url);
        setSrc(url);
      } };
      queue.push(job); pump();
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => { io.disconnect(); if (job) { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); } };
  }, [e.key, src]);
  return (
    <button ref={ref} className={`pxl-thumb ${on ? 'on' : ''}`} onClick={onPick} title={e.name}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="pxl-ph" />}
      <span className="pxl-name">{e.name}</span>
    </button>
  );
}

export function LibraryWindow({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<Category | 'All'>('All');
  const [q, setQ] = useState('');
  const [palette, setPalette] = useState<string>('any');
  const [limit, setLimit] = useState(PAGE);
  const [entry, setEntry] = useState<LibraryEntry | null>(null);
  const counts = useMemo(() => libraryCounts(), []);
  const list = useMemo(() => searchLibrary(q, cat).filter((e) => palette === 'any' || e.palette === palette), [q, cat, palette]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(PAGE), [q, cat, palette]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([h]) => { if (h.isIntersecting) setLimit((l) => Math.min(list.length, l + PAGE)); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { if (!entry && list.length) setEntry(list[0]); }, [list, entry]);

  return createPortal(
    <div className="pxl-bg" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="pxl-win" role="dialog" aria-label="Pattern library">
        <header className="pxl-head">
          <span className="mx-badge">P</span>
          <div className="pxl-title">Pattern library<span className="mx-muted"> · {counts.All.toLocaleString()} patterns in {CATEGORIES.length} types</span></div>
          <input className="input pxl-search" placeholder="Search: hex, maze, waves, ocean…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>✕</button>
        </header>
        <div className="pxl-body">
          <nav className="pxl-cats">
            {(['All', ...CATEGORIES] as const).map((c) => (
              <button key={c} className={`pxl-cat ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}<span>{counts[c].toLocaleString()}</span></button>
            ))}
            <div className="mx-label" style={{ marginTop: 12 }}>Palette</div>
            <button className={`pxl-cat ${palette === 'any' ? 'on' : ''}`} onClick={() => setPalette('any')}>Any</button>
            {PALETTES.map((p) => (
              <button key={p.id} className={`pxl-cat ${palette === p.id ? 'on' : ''}`} onClick={() => setPalette(p.id)}>
                <span className="pxl-pal">{p.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>{p.name}
              </button>
            ))}
          </nav>
          <section className="pxl-grid-wrap">
            <div className="mx-muted">{list.length.toLocaleString()} result(s)</div>
            <div className="pxl-grid">
              {list.slice(0, limit).map((e) => <Thumb key={e.key} e={e} on={entry?.key === e.key} onPick={() => setEntry(e)} />)}
            </div>
            {limit < list.length && <div ref={sentinel} className="pxl-more">Loading more…</div>}
          </section>
          {entry && <Editor key={entry.key} entry={entry} onClose={onClose} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Editor({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const fam = familyById(entry.family)!;
  const [spec, setSpec] = useState<GenSpec>(() => specOf(entry));
  const [target, setTarget] = useState<Target>({ kind: 'side', side: 'top' });
  const [fitTarget, setFitTarget] = useState(true);
  const obj = targetObject();
  const slots = useStore((s) => s.filaments.length);
  const tsize = targetSize(obj, target);
  // the preview uses the size the pattern will have on the target
  const shown: GenSpec = fitTarget && tsize ? { ...spec, width: +tsize.width.toFixed(2), height: +tsize.height.toFixed(2) } : spec;
  const pat = useMemo(() => buildPattern(shown, `${entry.name}`), [JSON.stringify(shown)]);
  const pal = paletteOf(spec.palette);
  const svg = useMemo(() => svgUrl(patternSvg(pat, shown.width, shown.height, pal.colors[0])), [pat]);
  const groups = new Set(pat.shapes.map((s) => s.fill_color)).size;
  const set = (k: string, v: number) => setSpec((s) => ({ ...s, params: { ...s.params, [k]: v } }));
  const apply = () => {
    const make = (w: number, h: number) => buildPattern({ ...spec, width: fitTarget ? w : spec.width, height: fitTarget ? h : spec.height }, entry.name);
    if (target.kind === 'face' || !obj) {
      const p = addPattern(px, buildPattern(spec, entry.name));
      px.armed = p.id;
      useStore.getState().set({ tool: 'place_pattern', workspace: 'prepare' });
      changed(false);
    } else {
      applyToObject(px, obj, target, make, slots);
      useStore.getState().set({ workspace: 'prepare' });
      changed(true);
    }
    onClose();
  };
  return (
    <aside className="pxl-editor">
      <div className="pxl-preview">
        <img src={svg} alt="Pattern preview" />
        <Cube svg={svg} target={target} />
      </div>
      <div className="pxl-ed-title"><b>{entry.name}</b><span className="mx-muted"> · {fam.category} · {groups} colour group(s) · {shown.width.toFixed(1)} × {shown.height.toFixed(1)} mm</span></div>
      <div className="pxl-ed-scroll">
        <div className="mx-label">Apply to {obj ? <span className="mx-muted">({obj.name})</span> : <span className="px-warn"> (add a model first)</span>}</div>
        <div className="mx-chips">
          <button className={`btn-secondary btn-small ${target.kind === 'face' ? 'on' : ''}`} onClick={() => setTarget({ kind: 'face' })}>Picked face</button>
          {SIDES.map((s) => <button key={s} className={`btn-secondary btn-small ${target.kind === 'side' && target.side === s ? 'on' : ''}`} onClick={() => setTarget({ kind: 'side', side: s as Side })}>{s}</button>)}
          <button className={`btn-secondary btn-small ${target.kind === 'sides' ? 'on' : ''}`} onClick={() => setTarget({ kind: 'sides' })}>All 4 sides</button>
          <button className={`btn-secondary btn-small ${target.kind === 'wrap' ? 'on' : ''}`} onClick={() => setTarget({ kind: 'wrap' })}>Whole body (wrap)</button>
        </div>
        {target.kind === 'face' && <p className="mx-muted">After Apply, click a face on the model; drag to move it.</p>}
        <label className="mx-field px-check"><input type="checkbox" checked={fitTarget} disabled={target.kind === 'face'} onChange={(e) => setFitTarget(e.target.checked)} />Fit the pattern to the target (keeps cell size, covers the whole area)</label>
        {(!fitTarget || target.kind === 'face') && (
          <div className="mx-two">
            <Slider label="Width (mm)" min={5} max={250} step={1} value={spec.width} onChange={(v) => setSpec((s) => ({ ...s, width: v }))} />
            <Slider label="Height (mm)" min={5} max={250} step={1} value={spec.height} onChange={(v) => setSpec((s) => ({ ...s, height: v }))} />
          </div>
        )}
        <div className="mx-label">Shape</div>
        {fam.params.map((d) => <Slider key={d.key} label={d.label} min={d.min} max={d.max} step={d.step} value={spec.params[d.key] ?? d.def} onChange={(v) => set(d.key, v)} />)}
        {fam.seeded && (
          <div className="px-row"><Slider label="Seed" min={1} max={9999} step={1} value={spec.seed} onChange={(v) => setSpec((s) => ({ ...s, seed: v }))} />
            <button className="btn-secondary btn-small" title="Random seed" onClick={() => setSpec((s) => ({ ...s, seed: 1 + Math.floor(Math.random() * 9999) }))}>🎲</button></div>
        )}
        <div className="mx-label">Palette (colour 1 = base material)</div>
        <div className="mx-chips">
          {PALETTES.map((p) => (
            <button key={p.id} className={`btn-secondary btn-small ${spec.palette === p.id ? 'on' : ''}`} onClick={() => setSpec((s) => ({ ...s, palette: p.id }))}>
              <span className="pxl-pal">{p.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>{p.name}
            </button>
          ))}
        </div>
        <button className="btn-secondary btn-small" onClick={() => setSpec(specOf(entry))}>Reset to preset</button>
      </div>
      <footer className="pxl-ed-foot">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!obj && target.kind !== 'face'} onClick={apply}>Apply{target.kind === 'face' ? ' — then click a face' : ''}</button>
      </footer>
    </aside>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mx-field pxl-slider">
      <span className="px-row"><span style={{ flex: 1 }}>{label}</span>
        <input className="input pxl-num" type="number" min={min} max={max} step={step} value={+value.toFixed(3)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} />
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** A turning cube that shows where the pattern goes: one face, four sides, or wrapped round. */
function Cube({ svg, target }: { svg: string; target: Target }) {
  const faces: [string, string][] = [['top', 'rotateX(90deg)'], ['bottom', 'rotateX(-90deg)'], ['front', 'rotateY(0deg)'], ['back', 'rotateY(180deg)'], ['right', 'rotateY(90deg)'], ['left', 'rotateY(-90deg)']];
  const on = (f: string) => target.kind === 'wrap' || (target.kind === 'sides' && f !== 'top' && f !== 'bottom') || (target.kind === 'side' && target.side === f) || (target.kind === 'face' && f === 'top');
  return (
    <div className="pxl-cube-wrap" title="Where it goes">
      <div className="pxl-cube">
        {faces.map(([f, t]) => <div key={f} className={`pxl-face ${on(f) ? 'on' : ''}`} style={{ transform: `${t} translateZ(45px)`, backgroundImage: on(f) ? `url("${svg}")` : undefined }}>{!on(f) && f}</div>)}
      </div>
    </div>
  );
}
