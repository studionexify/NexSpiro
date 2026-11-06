// Colour mixing (Snapmaker Orca style): mixed filaments built from the physical ones by alternating layers.
// Shown for tool changers (Snapmaker U1), where a change is a head swap with no purge.
import { useState } from 'react';
import { useStore } from '../state/store';
import { MAX_CYCLE, MAX_RATIO, mixColor, mixLabel, mixProblems, mixSequence, shiftIndex, type MixedFilament } from '../profiles/mixing';
import { Modal } from './Modals';
import { Icon } from './icons';

const newMixId = () => `mix-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Shift every object / paint reference at or after `from` by `delta`; references to `gone` go to filament 1. */
export function shiftFilamentRefs(gone: number | null, from: number, delta: number) {
  const st = useStore.getState();
  st.updateObjects((o) => ({
    ...o,
    filament: shiftIndex(o.filament, gone, from, delta),
    paint: o.paint?.color ? { ...o.paint, color: o.paint.color.map((c: number) => (c === 0 ? 0 : (shiftIndex(c - 1, gone, from, delta) ?? 0) + 1)) } : o.paint,
  }), st.objects.map((o) => o.id));
}

function LayerStrip({ mix, colors, layers = 12 }: { mix: MixedFilament; colors: string[]; layers?: number }) {
  const seq = mixSequence(mix);
  return (
    <div className="mix-strip" title="Layers from the bottom up" style={{ display: 'flex', flexDirection: 'column-reverse', width: 56, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      {Array.from({ length: layers }, (_, i) => <div key={i} style={{ height: 6, background: colors[seq[i % seq.length]] ?? '#888' }} />)}
    </div>
  );
}

function FilPick({ value, colors, onChange, label }: { value: number; colors: string[]; onChange: (k: number) => void; label: string }) {
  return (
    <div className="palette" role="radiogroup" aria-label={label}>
      {colors.map((c, k) => <button key={k} role="radio" aria-checked={value === k} className={`pal ${value === k ? 'on' : ''}`} style={{ background: c, boxShadow: 'inset 0 0 0 1px var(--border)' }} onClick={() => onChange(k)} title={`Filament ${k + 1}`}>{k + 1}</button>)}
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="icon-btn" aria-label={`Less ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <span className="mono" style={{ minWidth: 16, textAlign: 'center' }} aria-label={label}>{value}</span>
      <button className="icon-btn" aria-label={`More ${label}`} disabled={value >= MAX_RATIO} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

export function MixModal({ initial, onSave, onClose }: { initial?: MixedFilament; onSave: (m: MixedFilament) => void; onClose: () => void }) {
  const colors = useStore((s) => s.filaments.map((f) => f.color));
  const [tab, setTab] = useState<'ratio' | 'cycle'>(initial?.kind ?? 'ratio');
  const [a, setA] = useState(initial?.kind === 'ratio' ? initial.a : 0);
  const [b, setB] = useState(initial?.kind === 'ratio' ? initial.b : Math.min(1, colors.length - 1));
  const [ra, setRa] = useState(initial?.kind === 'ratio' ? initial.ra : 1);
  const [rb, setRb] = useState(initial?.kind === 'ratio' ? initial.rb : 1);
  const [seq, setSeq] = useState<number[]>(initial?.kind === 'cycle' ? initial.seq : [0, Math.min(1, colors.length - 1)]);
  const id = initial?.id ?? newMixId();
  const mix: MixedFilament = tab === 'ratio' ? { id, name: initial?.name, kind: 'ratio', a, b, ra, rb } : { id, name: initial?.name, kind: 'cycle', seq };
  const problems = mixProblems(mix, colors.length);
  const color = mixColor(mix, colors);
  return (
    <Modal title={initial ? 'Edit mix' : 'Add mix'} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn-secondary btn-small" onClick={onClose}>Cancel</button>
      <button className="btn-primary btn-small" disabled={problems.length > 0} onClick={() => { onSave(mix); onClose(); }}>{initial ? 'Save' : 'Add'}</button>
    </>}>
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === 'ratio'} className={tab === 'ratio' ? 'on' : ''} onClick={() => setTab('ratio')}>Ratio</button>
        <button role="tab" aria-selected={tab === 'cycle'} className={tab === 'cycle' ? 'on' : ''} onClick={() => setTab('cycle')}>Cycle</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tab === 'ratio' ? <>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Two filaments alternate layer by layer. The ratio sets how many layers of each are printed in turn.</p>
            <div><div className="muted" style={{ fontSize: 12 }}>Filament A</div><FilPick label="Filament A" value={a} colors={colors} onChange={setA} /></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Filament B</div><FilPick label="Filament B" value={b} colors={colors} onChange={setB} /></div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Ratio A : B</span>
              <Stepper label="A layers" value={ra} onChange={setRa} /><span>:</span><Stepper label="B layers" value={rb} onChange={setRb} />
              <span className="muted mono" style={{ fontSize: 12 }}>{Math.round((100 * ra) / (ra + rb))}% / {Math.round((100 * rb) / (ra + rb))}%</span>
            </div>
          </> : <>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>A sequence of filaments repeated from the first layer up, one filament per layer. Click filaments to add them in order.</p>
            <FilPick label="Add filament to the cycle" value={-1} colors={colors} onChange={(k) => setSeq((q) => (q.length < MAX_CYCLE ? [...q, k] : q))} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }} aria-label="Cycle">
              {seq.map((k, i) => (
                <span key={i} className="badge" style={{ background: colors[k], color: '#fff', textShadow: '0 0 2px #000' }}>
                  {k + 1}<button className="icon-btn" style={{ width: 16, height: 16 }} aria-label={`Remove step ${i + 1}`} onClick={() => setSeq((q) => q.filter((_, j) => j !== i))}><Icon name="close" size={10} /></button>
                </span>
              ))}
              {seq.length > 0 && <button className="btn-secondary btn-small" onClick={() => setSeq([])}>Clear</button>}
            </div>
          </>}
          {problems.length > 0 && <div style={{ color: 'var(--warning)', fontSize: 12 }}>{problems.join(' ')}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 56, height: 56, borderRadius: 8, background: color, border: '1px solid var(--border)' }} title="Expected colour" />
          <span className="mono muted" style={{ fontSize: 11 }}>{color}</span>
          <LayerStrip mix={mix} colors={colors} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>The colour shown is an estimate. Thin layers (0.08–0.12 mm) blend best; check the side of a test print in daylight.</p>
    </Modal>
  );
}

/** Mixed filament list under the physical filament slots. */
export function ColorMixingSection() {
  const { filaments, mixes, set, markDirty } = useStore();
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const colors = filaments.map((f) => f.color);
  const P = filaments.length;
  const save = (m: MixedFilament) => {
    const next = edit === 'new' || edit === null ? [...mixes, m] : mixes.map((x, i) => (i === edit ? m : x));
    set({ mixes: next }); markDirty();
  };
  const remove = (k: number) => {
    shiftFilamentRefs(P + k, P + k + 1, -1);
    set({ mixes: mixes.filter((_, i) => i !== k) }); markDirty();
  };
  return (
    <div className="mixes" style={{ marginTop: 8 }}>
      <div className="row">
        <span style={{ fontWeight: 600, fontSize: 12 }}>Color mixing</span>
        <span className="spacer" />
        <button className="btn-secondary btn-small" disabled={P < 2} title={P < 2 ? 'Add a second filament first' : 'Make a new colour from the loaded filaments'} onClick={() => setEdit('new')}><Icon name="add" size={12} /> Add mix</button>
      </div>
      {mixes.length === 0 && <div className="muted" style={{ fontSize: 12 }}>New colours from the loaded filaments by alternating layers. Mixed filaments are numbered after the slots ({P + 1}, {P + 2} …) and can be set on objects or painted.</div>}
      {mixes.map((m, k) => {
        const problems = mixProblems(m, P);
        return (
          <div className="row slot" key={m.id}>
            <span className="swatch-btn" style={{ background: mixColor(m, colors) }} title="Expected colour"><span>{P + k + 1}</span></span>
            <span style={{ flex: 1, fontSize: 12 }}>{m.kind === 'ratio' ? 'Ratio' : 'Cycle'} · <span className="mono">{mixLabel(m)}</span></span>
            {problems.length > 0 && <span title={problems.join(' ')} style={{ color: 'var(--warning)', display: 'flex' }}><Icon name="warn" size={14} /></span>}
            <button className="icon-btn" title="Edit mix" onClick={() => setEdit(k)}><Icon name="edit" size={16} /></button>
            <button className="icon-btn" title="Remove mix" onClick={() => remove(k)}><Icon name="close" size={14} /></button>
          </div>
        );
      })}
      {edit !== null && <MixModal initial={edit === 'new' ? undefined : mixes[edit]} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  );
}
