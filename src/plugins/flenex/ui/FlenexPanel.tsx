// Flenex in the right dock: a short summary and the way into the Studio.
import { useStore } from '../../../state/store';
import { printerById } from '../../../profiles/printers';
import { PRESETS } from '../presets';
import { built, fx, loadPreset, openStudio, useFx } from './state';

export function FlenexPanel() {
  useFx();
  const printer = printerById(useStore((s) => s.printerId));
  return (
    <div className="mx-panel">
      <div className="mx-card">
        <div className="mx-card-title">Flenex</div>
        <div className="mx-sub">Print-in-place flexi animals and characters: design one from {PRESETS.length} shapes, or import a model and place the joints where you want them. Paint it, then export a coloured 3MF or send it to the plate.</div>
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => openStudio(true)}>Open Flenex Studio</button>
      </div>
      <div className="mx-card">
        <div className="mx-card-title">Machine</div>
        <div className="mx-sub">{printer.vendor} {printer.model} · nozzle {printer.nozzle} mm · bed {printer.bed.x} × {printer.bed.y} mm. Joint clearance and colour limits follow this printer.</div>
      </div>
      <div className="mx-card">
        <div className="mx-card-title">Current design</div>
        <div className="mx-sub"><b>{fx.source === 'import' ? fx.importName : fx.design.name}</b>{built ? ` · ${built.flexi.pieceCount} pieces · ${built.cuts.length} joints` : ''}</div>
        <div className="fx-chips" style={{ marginTop: 6 }}>
          {['snake', 'dragon', 'fish', 'gecko', 'octopus'].map((id) => <button key={id} className="btn-small btn-secondary" onClick={() => { loadPreset(id); openStudio(true); }}>{PRESETS.find((p) => p.id === id)?.name}</button>)}
        </div>
      </div>
    </div>
  );
}
