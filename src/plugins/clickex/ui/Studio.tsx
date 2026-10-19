// Clickex Studio: a full-window editor over NexSpiro, laid out like MakerWorld's clicker generator.
// Left: icon rail and the settings of the selected tab. Centre: the live 3D view (assembled, exploded, or as
// it prints) with the real switch. Right: where the design comes from, and the ways out.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PRINTERS, printerById } from '../../../profiles/printers';
import { useStore } from '../../../state/store';
import type { DesignMode } from '../model';
import { Ico, Note } from './controls';
import { Panel, Rail } from './Panels';
import { SourcePanel } from './Sources';
import { Viewer } from './Viewer';
import { canRedo, canUndo, changed, compute, cx, download3mf, openStudio, redo, resetDesign, saveDesign, say, transferToPlate, undo, useCx, type View } from './state';

export function ClickexStudioHost() {
  useCx();
  const installed = useStore((s) => s.plugins.includes('clickex'));
  if (!installed || !cx.studioOpen || typeof document === 'undefined') return null;
  return createPortal(<Studio />, document.body);
}

const VIEWS: [View, string][] = [['assembled', 'Assembled'], ['exploded', 'Exploded'], ['print', 'Print layout']];
const MODES: [DesignMode, string][] = [['color', 'Color'], ['raise', 'Raise'], ['engrave', 'Engrave']];

function PlateSelect() {
  const s = useStore();
  const p = printerById(s.printerId);
  return (
    <label className="cx-plate" title="Build plate of the printer you are designing for">
      <Ico name="printer" size={15} />
      <select value={s.printerId} onChange={(e) => { const np = PRINTERS.find((x) => x.id === e.target.value)!; s.set({ printerId: np.id, plate: np.plates.some((x) => x.type === s.plate) ? s.plate : np.plates[0].type, machineOverrides: {} }); }}>
        {PRINTERS.map((x) => <option key={x.id} value={x.id}>{x.vendor} {x.model}</option>)}
      </select>
      <span>{p.bed.x} × {p.bed.y} mm</span>
    </label>
  );
}

function Overlay() {
  useCx();
  const c = compute();
  const r = c.built?.report;
  const [notes, setNotes] = useState(false);
  const source = cx.spec.source;
  const sizeText = r && r.size[0] ? `${r.size[0]} × ${r.size[1]} × ${r.size[2]} mm · button ${r.buttonGrams} g` : '';
  const fits = r ? (r.fits ? '✓ fits an MX switch' : '✕ switch does not fit') : '';
  const waiting = c.waiting || (!c.built && !(source === 'model' && !c.model));
  const hint = source === 'model' && !c.model ? 'Pick a sample or drop a 3D model on the right.' : source === 'image' && !cx.spec.image ? 'Upload an image on the right, or pick a sample.' : c.waiting ? 'Reading the design…' : '';
  return (
    <>
      <div className="cx-viewbar">
        <div className="cx-pill">
          {VIEWS.map(([v, l]) => <button key={v} className={cx.view === v ? 'on' : ''} onClick={() => { cx.view = v; changed(false); }}>{l}</button>)}
          <span className="cx-sep" />
          <button className={`cx-dotbtn ${cx.showSwitch ? 'on' : ''}`} onClick={() => { cx.showSwitch = !cx.showSwitch; changed(false); }}><i />Show MX switch</button>
          <button className={`cx-dotbtn ${cx.cutOpen ? 'on' : ''}`} onClick={() => { cx.cutOpen = !cx.cutOpen; changed(false); }}><i />Cut it open</button>
        </div>
        {source !== 'model' && (
          <div className="cx-pill small">
            {MODES.map(([v, l]) => <button key={v} className={cx.spec.colors.mode === v ? 'on' : ''} onClick={() => { cx.spec.colors.mode = v; changed(); }}>{l}</button>)}
          </div>
        )}
        {cx.view === 'assembled' && (
          <div className="cx-pill small press">
            <span>Press</span>
            <input type="range" min={0} max={1} step={0.01} value={cx.press} onChange={(e) => { cx.press = parseFloat(e.target.value); changed(false); }} aria-label="Press the button" />
          </div>
        )}
      </div>
      {(hint || waiting) && <div className="cx-empty">{hint || 'Building…'}</div>}
      {r && r.warnings.length > 0 && (
        <div className="cx-notes">
          <button className="cx-chipbtn warn" onClick={() => setNotes(!notes)}>⚠ {r.warnings.length} note{r.warnings.length > 1 ? 's' : ''}</button>
          {notes && <div className="cx-notelist">{r.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
        </div>
      )}
      {sizeText && <div className="cx-status">{sizeText} · <b className={r?.fits ? 'ok' : 'bad'}>{fits}</b> · {c.ms.toFixed(0)} ms</div>}
      <div className="cx-hint">Hold left click to rotate, right click to pan, scroll to zoom.</div>
    </>
  );
}

function Studio() {
  useCx();
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openStudio(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  const send = () => { const r = transferToPlate(); if (r) { say(`${r.count} part${r.count > 1 ? 's' : ''} placed on ${r.plate}.`); setTimeout(() => openStudio(false), 900); } };
  return (
    <div className="cx-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) openStudio(false); }}>
      <div className="cx-studio" role="dialog" aria-label="Clickex Studio" data-theme-host>
        <header className="cx-top">
          <button className="cx-back" onClick={() => openStudio(false)} aria-label="Close"><Ico name="chevron-left" size={20} /><b>Clicker Generator</b></button>
          <input className="cx-name" value={cx.spec.name} onChange={(e) => { cx.spec.name = e.target.value; changed(false); }} aria-label="Design name" />
          <button className="cx-btn small" onClick={saveDesign} title="Save this design to your library"><Ico name="save" size={15} /> Save</button>
          <span className="cx-grow" />
          <PlateSelect />
        </header>
        <div className="cx-body">
          <aside className="cx-left">
            <div className="cx-leftbody"><Rail /><div className="cx-panel"><Panel /></div></div>
            <footer className="cx-history">
              <button onClick={undo} disabled={!canUndo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Ico name="undo-2" size={18} /></button>
              <button onClick={resetDesign} title="Reset the settings of this design" aria-label="Reset"><Ico name="rotate-ccw" size={18} /></button>
              <button onClick={redo} disabled={!canRedo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Ico name="redo-2" size={18} /></button>
            </footer>
          </aside>
          <main className="cx-centre"><Viewer /><Overlay /></main>
          <aside className="cx-right">
            <div className="cx-rightbody"><SourcePanel /></div>
            <footer className="cx-actions">
              <button className="cx-btn primary big" onClick={() => download3mf().catch((e) => say(`Download failed: ${(e as Error).message}`))}>Download 3MF</button>
              <button className="cx-btn big" onClick={send}>Send to plate</button>
              <button className="cx-btn big" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}><Ico name={theme === 'dark' ? 'sun' : 'moon'} size={16} /> {theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
            </footer>
          </aside>
        </div>
        {cx.toast && <div className="cx-toast">{cx.toast}</div>}
      </div>
    </div>
  );
}

export { Note };
