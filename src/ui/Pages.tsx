import { PRINTERS, printerName } from '../profiles/printers';
import { FILAMENTS } from '../profiles/filaments';
import { CONNECTION_INFO } from '../connect/types';
import { addSample, importDialog, SAMPLES } from '../state/actions';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function HomePage() {
  const { set, objects } = useStore();
  return (
    <div className="page">
      <div className="hero">
        <h1>Welcome to NexSpiro</h1>
        <p className="lead" style={{ maxWidth: 560 }}>Prepare, slice and send 3D prints for Bambu Lab, Creality, Elegoo and more — locally on your computer.</p>
        <div className="row">
          <button className="btn-primary" onClick={importDialog}><Icon name="add" />Import model</button>
          {objects.length > 0 && <button className="btn-secondary" style={{ background: 'rgba(20,32,48,.5)', color: '#F6EEE6' }} onClick={() => set({ workspace: 'prepare' })}>Continue on plate ({objects.length})</button>}
        </div>
        <img src="./logo-dark.svg" alt="" />
      </div>
      <h2>Start from a sample</h2>
      <div className="grid-cards">
        {SAMPLES.map((s) => (
          <div key={s.id} className="tile click" onClick={() => addSample(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && addSample(s.id)}>
            <Icon name="cube" size={22} style={{ color: 'var(--accent)' }} />
            <h3>{s.name}</h3><p>{s.description}</p>
          </div>
        ))}
      </div>
      <h2>Supported printers</h2>
      <div className="grid-cards">
        {PRINTERS.map((p) => (
          <div key={p.id} className="tile click" onClick={() => { set({ printerId: p.id, plate: p.plates[0].type, workspace: 'prepare' }); }}>
            <span className="pill">{p.vendor}</span>
            <h3>{p.model}</h3>
            <p>{p.bed.x}×{p.bed.y}×{p.bed.z} mm · {p.nozzle} mm nozzle · {p.flavor === 'klipper' ? 'Klipper' : p.flavor === 'bambu' ? 'Bambu firmware' : 'Marlin'}</p>
          </div>
        ))}
      </div>
      <h2>Keyboard shortcuts</h2>
      <div className="tile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
        {[['Ctrl+I', 'Add model'], ['Ctrl+R', 'Slice plate'], ['Ctrl+G', 'Export G-code'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['M / R / S / F', 'Move / Rotate / Scale / Lay on face'],
          ['A', 'Arrange'], ['O', 'Auto orient'], ['Del', 'Delete'], ['Ctrl+D', 'Duplicate'], ['Ctrl+A', 'Select all'], ['Ctrl+1…5', 'Switch workspace'], ['↑ / ↓', 'Layer slider (Preview)']].map(([k, v]) => (
          <div key={k} className="row" style={{ margin: 0 }}><span className="badge mono">{k}</span><span>{v}</span></div>
        ))}
      </div>
    </div>
  );
}

export function DevicePage() {
  return (
    <div className="page">
      <h1>Devices</h1>
      <p className="lead">Connect printers over your local network to send prints, watch progress and the camera, and manage files. Every connection runs directly from this computer — no cloud required.</p>
      <span className="pill"><Icon name="info" size={14} />Printer connections are built in Phase 3 — the connection layer is already designed below.</span>
      <h2>Your printers</h2>
      <div className="grid-cards">
        {PRINTERS.map((p) => (
          <div key={p.id} className="tile">
            <div className="row" style={{ marginTop: 0 }}><Icon name="printer" style={{ color: 'var(--accent)' }} /><b style={{ color: 'var(--text-strong)' }}>{printerName(p)}</b></div>
            <p style={{ marginTop: 6 }}>Connection: {p.connections.map((c) => CONNECTION_INFO[c].label).join(', ')}</p>
            <button className="btn-secondary btn-small" style={{ marginTop: 10 }} disabled title="Available in Phase 3"><Icon name="wifi" size={14} />Connect</button>
          </div>
        ))}
      </div>
      <h2>Supported connection types</h2>
      <div className="grid-cards">
        {Object.entries(CONNECTION_INFO).map(([k, c]) => (
          <div key={k} className="tile"><h3>{c.label}</h3><p>{c.description}</p></div>
        ))}
      </div>
    </div>
  );
}

export function ProjectPage() {
  const { objects, printerId, filamentId, presetId } = useStore();
  return (
    <div className="page">
      <h1>Project</h1>
      <p className="lead">Plate summary for the current project. Rich project notes, BOM and photos inside .3mf files arrive in Phase 3.</p>
      <div className="tile" style={{ maxWidth: 640 }}>
        <div className="summary" style={{ marginTop: 0, border: 0, paddingTop: 0 }}>
          <span className="k">Printer</span><span className="v">{printerName(PRINTERS.find((p) => p.id === printerId)!)}</span>
          <span className="k">Filament</span><span className="v">{FILAMENTS.find((f) => f.id === filamentId)?.name}</span>
          <span className="k">Process</span><span className="v">{presetId} mm</span>
          <span className="k">Objects</span><span className="v">{objects.length}</span>
        </div>
        {objects.map((o) => <div key={o.id} className="row"><Icon name="cube" size={14} />{o.name}<span className="spacer" /><span className="badge">{(o.mesh.indices.length / 3).toLocaleString()} triangles</span></div>)}
      </div>
    </div>
  );
}

export function CalibrationPage() {
  const items = [
    ['Flow dynamics (pressure advance)', 'Prints a pattern of lines at different K values to find the best pressure advance.'],
    ['Flow rate', 'Two-pass coarse/fine top-surface test to dial in the extrusion multiplier.'],
    ['Max volumetric speed', 'Ramps flow until under-extrusion appears to find the hotend limit.'],
    ['Temperature tower', 'Steps nozzle temperature by height to find the best print temperature.'],
    ['Retraction test', 'Towers with increasing retraction length to remove stringing.'],
  ];
  return (
    <div className="page">
      <h1>Calibration</h1>
      <p className="lead">Guided calibration routines generate dedicated test models and G-code. Planned for Phase 3.</p>
      <div className="grid-cards">
        {items.map(([t, d]) => <div key={t} className="tile"><Icon name="calib" style={{ color: 'var(--accent)' }} /><h3>{t}</h3><p>{d}</p></div>)}
      </div>
    </div>
  );
}
