// Per-plate controls, after Bambu Studio: the icon column beside each plate (remove, orient,
// arrange, lock, settings), the plate number, and the plate settings dialog.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { printerById, type PlateType } from '../profiles/printers';
import { useStore } from '../state/store';
import { deletePlate, arrange, orientPlate, updatePlate } from '../state/ops';
import { selectPlate } from '../state/objectOps';
import { plateObjects } from '../state/slicing';
import { Icon } from './icons';
import { Modal } from './Modals';

/** Screen anchors of each plate, written by the viewport after every frame it draws. */
export interface PlateAnchor { icons: [number, number] | null; label: [number, number] | null }
export const plateAnchors: { current: PlateAnchor[]; listeners: Set<() => void> } = { current: [], listeners: new Set() };

const usePlateDialog = create<{ index: number | null }>(() => ({ index: null }));
export const openPlateSettings = (index: number) => usePlateDialog.setState({ index });

export function PlateControls() {
  const s = useStore();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const place = () => {
      plateAnchors.current.forEach((a, i) => {
        const el = refs.current[i], lb = labels.current[i];
        if (el) { el.style.display = a.icons ? '' : 'none'; if (a.icons) el.style.transform = `translate(${a.icons[0]}px, ${a.icons[1]}px)`; }
        if (lb) { lb.style.display = a.label ? '' : 'none'; if (a.label) lb.style.transform = `translate(${a.label[0]}px, ${a.label[1]}px) translate(-50%, -50%)`; }
      });
    };
    plateAnchors.listeners.add(place);
    place();
    return () => { plateAnchors.listeners.delete(place); };
  }, [s.plates.length]);
  return (
    <div className="plate-controls">
      {s.plates.map((p, i) => {
        const active = i === s.activePlate;
        const lockTip = p.locked ? 'Unlock plate' : 'Lock plate: arrange and auto orient leave it alone';
        return (
          <div key={p.id}>
            <div ref={(el) => { refs.current[i] = el; }} className={`plate-icons ${active ? 'active' : ''}`} style={{ display: 'none' }}
              onPointerDown={(e) => { e.stopPropagation(); if (!active) s.set({ activePlate: i }); }}>
              {s.plates.length > 1 && <button className="plate-icon" title="Remove plate" onClick={() => deletePlate(i)}><Icon name="close" size={15} /></button>}
              <button className="plate-icon" title="Auto orient objects on this plate" disabled={!!p.locked} onClick={() => orientPlate(i)}><Icon name="orient" size={15} /></button>
              <button className="plate-icon" title="Arrange objects on this plate" disabled={!!p.locked} onClick={() => arrange(6, i)}><Icon name="arrange" size={15} /></button>
              <button className={`plate-icon ${p.locked ? 'on' : ''}`} title={lockTip} onClick={() => updatePlate(i, { locked: !p.locked })}><Icon name={p.locked ? 'lock' : 'unlock'} size={15} /></button>
              <button className="plate-icon" title="Plate settings: name, bed type, spiral vase" onClick={() => openPlateSettings(i)}><Icon name="gear" size={15} /></button>
            </div>
            <button ref={(el) => { labels.current[i] = el; }} className={`plate-num ${active ? 'active' : ''}`} style={{ display: 'none' }}
              title={`${p.name}${p.bedType ? ` · ${printerById(s.printerId).plates.find((x) => x.type === p.bedType)?.label ?? ''}` : ''} — click to select its objects, double-click for settings`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { s.set({ activePlate: i }); selectPlate(i); }}
              onDoubleClick={() => openPlateSettings(i)}>
              {String(i + 1).padStart(2, '0')}{p.locked && <Icon name="lock" size={11} />}
            </button>
          </div>
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
  const ok = () => {
    updatePlate(index, {
      name: name.trim() || p.name, locked,
      bedType: bed === 'global' ? undefined : bed,
      spiralVase: vase === 'global' ? undefined : vase === 'on',
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
        <span>Locked</span>
        <label className="row" style={{ margin: 0 }}><button className={`toggle ${locked ? 'on' : ''}`} onClick={() => setLocked(!locked)} aria-label="Lock plate" />
          <span className="muted" style={{ fontSize: 12 }}>Arrange and auto orient skip a locked plate</span></label>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>The bed type sets this plate's bed temperatures when it is sliced. {plateObjects(index).length} object(s) on this plate.</p>
    </Modal>
  );
}
