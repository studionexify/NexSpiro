import { Fragment, useState, type ReactNode } from 'react';
import { filamentById } from '../profiles/filaments';
import { printerById, printerName } from '../profiles/printers';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <header>{title}<span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
        <div className="body">{children}</div>
        <footer>{footer ?? <button className="btn-secondary btn-small" onClick={onClose}>Close</button>}</footer>
      </div>
    </div>
  );
}

const MACHINE_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'retraction_length', label: 'Retraction length', unit: 'mm' },
  { key: 'retraction_speed', label: 'Retraction speed', unit: 'mm/s' },
  { key: 'deretraction_speed', label: 'Deretraction speed', unit: 'mm/s' },
  { key: 'z_hop', label: 'Z hop when retracting', unit: 'mm' },
  { key: 'retraction_minimum_travel', label: 'Retract only when travel exceeds', unit: 'mm' },
  { key: 'max_speed_z', label: 'Maximum Z speed', unit: 'mm/s' },
];

export function PrinterModal({ onClose }: { onClose: () => void }) {
  const { printerId, machineOverrides, setMachine } = useStore();
  const p = printerById(printerId);
  const value = (k: string) => (k in machineOverrides ? machineOverrides[k] : p.machine[k]);
  const [tab, setTab] = useState<'basic' | 'gcode'>('basic');
  return (
    <Modal title={`Printer settings — ${printerName(p)}`} onClose={onClose}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'basic' ? 'on' : ''} onClick={() => setTab('basic')}>Basic & extruder</button>
        <button className={tab === 'gcode' ? 'on' : ''} onClick={() => setTab('gcode')}>Machine G-code</button>
      </div>
      {tab === 'basic' ? (
        <div className="form-grid">
          <span>Printable area</span><span className="badge" style={{ textAlign: 'center' }}>{p.bed.x} × {p.bed.y} mm</span><span className="unit">mm</span>
          <span>Printable height</span><span className="badge" style={{ textAlign: 'center' }}>{p.bed.z}</span><span className="unit">mm</span>
          <span>Nozzle diameter</span><span className="badge" style={{ textAlign: 'center' }}>{p.nozzle}</span><span className="unit">mm</span>
          <span>G-code flavour</span><span className="badge" style={{ textAlign: 'center' }}>{p.flavor === 'bambu' ? 'Bambu Lab (Marlin)' : p.flavor === 'klipper' ? 'Klipper' : 'Marlin'}</span><span />
          {MACHINE_FIELDS.map((f) => (
            <MachineNumber key={f.key} label={f.label} unit={f.unit} value={Number(value(f.key))} modified={f.key in machineOverrides}
              onChange={(v) => setMachine(f.key, v === p.machine[f.key] ? undefined : v)} />
          ))}
        </div>
      ) : (
        <>
          {(['machine_start_gcode', 'machine_end_gcode', 'layer_change_gcode'] as const).map((k) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <b>{k === 'machine_start_gcode' ? 'Machine start G-code' : k === 'machine_end_gcode' ? 'Machine end G-code' : 'Layer change G-code'}</b>
                <span className="spacer" />
                {k in machineOverrides && <button className="icon-btn" style={{ color: 'var(--modified)' }} title="Reset" onClick={() => setMachine(k, undefined)}><Icon name="reset" size={14} /></button>}
              </div>
              <textarea spellCheck={false} value={String(value(k) ?? '')} onChange={(e) => setMachine(k, e.target.value)} />
            </div>
          ))}
          <p style={{ color: 'var(--text-muted)' }}>Placeholders such as <span className="mono">[nozzle_temperature_initial_layer]</span>, <span className="mono">[bed_temperature_initial_layer]</span>, <span className="mono">[layer_num]</span> and <span className="mono">[layer_z]</span> are expanded when slicing.</p>
        </>
      )}
    </Modal>
  );
}

function MachineNumber({ label, unit, value, modified, onChange }: { label: string; unit: string; value: number; modified: boolean; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <>
      <span style={{ color: modified ? 'var(--modified)' : undefined }}>{label}</span>
      <input className="input" style={{ textAlign: 'right', color: modified ? 'var(--modified)' : undefined }} value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) { const v = parseFloat(draft); if (isFinite(v) && v >= 0) onChange(v); setDraft(null); } }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="unit">{unit}</span>
    </>
  );
}

export function FilamentModal({ onClose }: { onClose: () => void }) {
  const { filamentId, plate } = useStore();
  const f = filamentById(filamentId);
  const rows: [string, string][] = [
    ['Type', f.type],
    ['Diameter', `${f.diameter} mm`],
    ['Density', `${f.density} g/cm³`],
    ['Price', `${f.cost} / kg`],
    ['Nozzle temperature', `${f.nozzleTemp} °C (first layer ${f.nozzleTempInitial} °C)`],
    ['Bed temperature (this plate)', f.bedTemp[plate] ? `${f.bedTemp[plate]} °C` : 'not supported'],
    ['Part cooling fan', `${f.fanMin}–${f.fanMax}% (off for first ${f.fanOffFirstLayers} layer${f.fanOffFirstLayers > 1 ? 's' : ''})`],
    ['Slow down if layer time below', `${f.slowDownLayerTime} s (min ${f.slowDownMinSpeed} mm/s)`],
    ['Max volumetric speed', `${f.maxVolumetricSpeed} mm³/s`],
    ['Flow ratio', String(f.flowRatio)],
  ];
  return (
    <Modal title={`Filament — ${f.name}`} onClose={onClose}>
      <div className="summary" style={{ marginTop: 0, border: 0 }}>
        {rows.map(([k, v]) => <Fragment key={k}><span className="k">{k}</span><span className="v">{v}</span></Fragment>)}
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 14 }}>Custom filament presets and multi-filament (AMS) slots arrive in Phase 2.</p>
    </Modal>
  );
}
