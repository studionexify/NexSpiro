// The 35 technologies grouped by compendium part: on/off per technology, machine verdict, last-slice
// status, and the parameter ("tensor weight") editor for power users.
import { TECH_BY_ID, type ParamSpec, type ResolvedTech } from '../../engine/advanced/techs';
import type { ParamValue, TechId, TechReport } from '../../engine/advanced/types';
import { resetTech, setTech, useAdvanced } from '../../state/advanced';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { useResolved } from './hooks';

export const PART_TITLES = ['', 'I · Core mathematical, field & kinematic', 'II · Micro-mechanics, biomimetics & viscoelastic', 'III · Differentiable solvers, PDEs & topology', 'IV · Seam elimination & surface perfection', 'V · Higher-dimensional mathematics'];

const STATUS_LABEL: Record<string, string> = { applied: 'Applied', adapted: 'Adapted', idle: 'Idle', disabled: 'Off', unavailable: 'N/A' };

/** Last slice's report for this technology, when the slice is current. */
export function useLastReport(): Map<TechId, TechReport> | null {
  const sl = useStore((s) => s.slice);
  if (sl.status !== 'done' || !sl.result?.advanced || sl.dirty) return null;
  return new Map(sl.result.advanced.techs.map((t) => [t.id, t]));
}

export function TechChip({ r, rep }: { r: ResolvedTech; rep?: TechReport }) {
  const forced = useAdvanced((a) => a.techs[r.def.id]?.enabled !== undefined);
  let cls = 'off', label = 'Off';
  if (rep) { cls = rep.status; label = STATUS_LABEL[rep.status]; }
  else if (r.enabled && r.verdict.status === 'unavailable') { cls = 'unavailable'; label = 'N/A'; }
  else if (r.enabled) { cls = r.verdict.status === 'adapted' ? 'adapted' : 'on'; label = forced ? 'On' : 'Auto'; }
  return <span className={`tech-chip ${cls}`} title={rep?.reason ?? r.verdict.reason ?? ''}>{label}</span>;
}

export function ParamEditor({ id, specs, values }: { id: TechId; specs: ParamSpec[]; values: Record<string, ParamValue> }) {
  const own = useAdvanced((a) => a.techs[id]?.params ?? {});
  if (!specs.length) return <div className="muted" style={{ fontSize: 11.5 }}>No parameters: driven entirely by the part's fields.</div>;
  return (
    <div className="tech-params">
      {specs.map((p) => {
        const v = values[p.key];
        const modified = p.key in own && own[p.key] !== p.def;
        return (
          <label key={p.key} className={`tech-param ${modified ? 'modified' : ''}`} title={p.tip ?? ''}>
            <span className="tp-label">{p.label}</span>
            {p.type === 'bool' ? (
              <button type="button" className={`toggle ${v ? 'on' : ''}`} aria-label={p.label} onClick={() => setTech(id, { param: [p.key, !v] })} />
            ) : p.type === 'enum' ? (
              <select className="select" value={String(v)} onChange={(e) => setTech(id, { param: [p.key, e.target.value] })}>
                {p.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <span className="tp-num">
                <input className="input" type="number" value={Number(v)} min={p.min} max={p.max} step={p.step}
                  onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setTech(id, { param: [p.key, p.min !== undefined && p.max !== undefined ? Math.max(p.min, Math.min(p.max, n)) : n] }); }} />
                {p.unit && <span className="muted">{p.unit}</span>}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function TechDetail({ r, rep }: { r: ResolvedTech; rep?: TechReport }) {
  const a = useAdvanced();
  const def = r.def;
  const overridden = !!a.techs[def.id];
  return (
    <div className="tech-detail">
      <div className="tech-summary">{def.summary}</div>
      <div className="tech-math-full mono">{def.math}</div>
      {r.verdict.reason && <div className={`tech-verdict ${r.verdict.status}`}><Icon name={r.verdict.status === 'unavailable' ? 'warn' : 'info'} size={13} />{r.verdict.reason}</div>}
      {rep?.stats && Object.keys(rep.stats).length > 0 && (
        <div className="tech-stats">
          {Object.entries(rep.stats).map(([k, v]) => <span key={k}><b>{k.replace(/_/g, ' ')}</b> {typeof v === 'number' ? +v.toFixed(3) : v}</span>)}
          {rep.ms !== undefined && <span><b>time</b> {Math.round(rep.ms)} ms</span>}
        </div>
      )}
      <ParamEditor id={def.id} specs={def.params} values={r.params} />
      {overridden && <button className="btn-secondary btn-small" style={{ marginTop: 6 }} onClick={() => resetTech(def.id)}><Icon name="reset" size={13} />Back to intent default</button>}
    </div>
  );
}

export function TechList() {
  const resolved = useResolved();
  const a = useAdvanced();
  const last = useLastReport();
  const parts = [1, 2, 3, 4, 5] as const;
  const activeCount = resolved.filter((r) => r.enabled && r.verdict.status !== 'unavailable').length;
  return (
    <section className="adv-section">
      <div className="adv-section-head">
        <span className="adv-h"><Icon name="atom" size={14} />Technologies</span>
        <span className="badge">{activeCount} of 35 active</span>
        <span className="spacer" />
        <button className="icon-btn" title="Engine node graph: fields → technologies → stages" onClick={() => a.set({ graphOpen: true })}><Icon name="graph" size={16} /></button>
      </div>
      {parts.map((part) => (
        <div key={part} className="tech-part">
          <div className="tech-part-title">{PART_TITLES[part]}</div>
          {resolved.filter((r) => r.def.part === part).map((r) => {
            const open = a.expanded === r.def.id;
            const rep = last?.get(r.def.id);
            return (
              <div key={r.def.id} className={`tech-row-wrap ${open ? 'open' : ''}`}>
                <div className="tech-row" onClick={() => a.set({ expanded: open ? null : r.def.id })}>
                  <span className="tech-n">{String(r.def.n).padStart(2, '0')}</span>
                  <span className="tech-name" title={`${r.def.name} — ${r.def.math}`}>{r.def.name}</span>
                  <TechChip r={r} rep={rep} />
                  <button className={`toggle ${r.enabled ? 'on' : ''}`} aria-label={`${r.enabled ? 'Turn off' : 'Turn on'} ${r.def.name}`}
                    onClick={(e) => { e.stopPropagation(); setTech(r.def.id, { enabled: !r.enabled }); }} />
                </div>
                {open && <TechDetail r={r} rep={rep} />}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

export const techName = (id: TechId) => TECH_BY_ID[id].name;
