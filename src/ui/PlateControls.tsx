// Plate list and the plate settings dialog (the per-plate icons are drawn on the bed, see viewport/plate.ts).
import { useState } from 'react';
import { create } from 'zustand';
import { printerById, type PlateType } from '../profiles/printers';
import { useStore } from '../state/store';
import { updatePlate } from '../state/ops';
import { plateObjects } from '../state/slicing';
import { Icon } from './icons';
import { Modal } from './Modals';

const usePlateDialog = create<{ index: number | null }>(() => ({ index: null }));
export const openPlateSettings = (index: number) => usePlateDialog.setState({ index });

/** Plate list down the right edge of the 3D view when the project has more than one plate (plate thumbnails). */
export function PlateList() {
  const s = useStore();
  if (s.plates.length < 2) return null;
  return (
    <div className="float plate-list" aria-label="Plates">
      {s.plates.map((p, i) => {
        const n = plateObjects(i).length;
        return (
          <button key={p.id} className={`plate-tile ${i === s.activePlate ? 'active' : ''}`} title={`${p.name} · ${n} object${n === 1 ? '' : 's'}${p.locked ? ' · locked' : ''}`}
            onClick={() => s.set({ activePlate: i })} onDoubleClick={() => openPlateSettings(i)}>
            <span className="plate-tile-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="plate-tile-count">{n}{p.locked && <Icon name="lock" size={10} />}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PlateSettingsHost() {
  const index = usePlateDialog((s) => s.index);
  const plate = useStore((s) => (index === null ? undefined : s.plates[index]));
  if (index === null || !plate) return null;
  return <PlateSettings key={plate.id} index={index} onClose={() => usePlateDialog.setState({ index: null })} />;
}

const tri = (v: boolean | undefined) => (v === undefined ? 'global' : v ? 'on' : 'off');

function PlateSettings({ index, onClose }: { index: number; onClose: () => void }) {
  const s = useStore();
  const p = s.plates[index];
  const printer = printerById(s.printerId);
  const globalBed = printer.plates.find((x) => x.type === s.plate)?.label ?? s.plate;
  const [name, setName] = useState(p.name);
  const [bed, setBed] = useState<PlateType | 'global'>(p.bedType ?? 'global');
  const [vase, setVase] = useState(tri(p.spiralVase));
  const [locked, setLocked] = useState(!!p.locked);
  const [seq, setSeq] = useState<string>(p.printSequence ?? 'global');
  const ok = () => {
    updatePlate(index, {
      name: name.trim() || p.name, locked,
      bedType: bed === 'global' ? undefined : bed,
      spiralVase: vase === 'global' ? undefined : vase === 'on',
      printSequence: seq === 'global' ? undefined : (seq as 'by_layer' | 'by_object'),
    });
    onClose();
  };
  return (
    <Modal title={`Plate settings — ${p.name}`} onClose={onClose}
      footer={<><button className="btn-secondary btn-small" onClick={onClose}>Cancel</button><button className="btn-primary btn-small" onClick={ok}>OK</button></>}>
      <div className="form-grid plate-form">
        <span>Plate name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} autoFocus />
        <span>Bed type</span>
        <select className="select" value={bed} onChange={(e) => setBed(e.target.value as PlateType | 'global')}>
          <option value="global">Same as global ({globalBed})</option>
          {printer.plates.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
        </select>
        <span>Spiral vase</span>
        <select className="select" value={vase} onChange={(e) => setVase(e.target.value)}>
          <option value="global">Same as global ({s.overrides.spiral_mode === true ? 'Enable' : 'Disable'})</option>
          <option value="on">Enable</option>
          <option value="off">Disable</option>
        </select>
        <span>Print sequence</span>
        <select className="select" value={seq} onChange={(e) => setSeq(e.target.value)}>
          <option value="global">Same as global ({s.overrides.print_sequence === 'by_object' ? 'By object' : 'By layer'})</option>
          <option value="by_layer">By layer</option>
          <option value="by_object">By object</option>
        </select>
        <span>Locked</span>
        <label className="row" style={{ margin: 0 }}><button className={`toggle ${locked ? 'on' : ''}`} onClick={() => setLocked(!locked)} aria-label="Lock plate" />
          <span className="muted" style={{ fontSize: 12 }}>Arrange and auto orient skip a locked plate</span></label>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>The bed type sets this plate's bed temperatures when it is sliced. {plateObjects(index).length} object(s) on this plate.</p>
    </Modal>
  );
}
