// Right-click menus on the 3D view, after Bambu Studio: one for an empty spot on a plate,
// one for an object (or a selection of objects) and one for a part.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { arrange, autoOrient, importDialog } from '../state/actions';
import {
  addShape, centreObjects, clearPlate, cloneObjects, copyObjects, dropObjects, exportStl, fillBed, hasClipboard, mirrorObjects,
  pasteObjects, renameObject, selectPlate, setObjectFilament, splitObject, togglePrintable,
} from '../state/objectOps';
import { addPart, addPlate, deletePlate, moveToPlate, PART_LABELS } from '../state/ops';
import { useStore, type ContextMenuState } from '../state/store';
import type { PartType } from '../engine/types';
import { applyPatternToObjects } from '../plugins/motionex/ui/MotionexPanel';

export interface MenuItem {
  label?: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  sub?: MenuItem[];
  sep?: true;
  swatch?: string;
}

const SHAPES: ['box' | 'cylinder' | 'sphere', string][] = [['box', 'Box'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere']];

function plateItems(m: ContextMenuState): MenuItem[] {
  const s = useStore.getState();
  const count = s.objects.length;
  return [
    { label: 'Add model…', kbd: 'Ctrl+I', onClick: importDialog },
    { label: 'Add shape', sub: [...SHAPES.map(([k, l]) => ({ label: l === 'Box' ? 'Cube' : l, onClick: () => addShape(k, m.world) })), { label: 'Text…', onClick: () => s.set({ tool: 'text', selected: [] }) }] },
    { label: 'Paste', kbd: 'Ctrl+V', disabled: !hasClipboard(), onClick: () => pasteObjects(m.world) },
    { sep: true },
    { label: 'Select all on plate', kbd: 'Ctrl+A', disabled: !count, onClick: () => selectPlate(m.plate) },
    { label: 'Arrange plate', kbd: 'A', disabled: !count, onClick: () => arrange(6, m.plate) },
    { label: 'Auto orient all', disabled: !count, onClick: () => { selectPlate(m.plate); autoOrient(); } },
    { label: 'Delete all on plate', disabled: !count, onClick: () => clearPlate(m.plate) },
    { sep: true },
    { label: 'Add plate', onClick: addPlate },
    { label: 'Delete plate', disabled: s.plates.length < 2, onClick: () => deletePlate(m.plate) },
  ];
}

function objectItems(m: ContextMenuState): MenuItem[] {
  const s = useStore.getState();
  const ids = s.selected.length ? s.selected : m.id ? [m.id] : [];
  const one = ids.length === 1 ? s.objects.find((o) => o.id === ids[0]) : undefined;
  const printable = !s.objects.filter((o) => ids.includes(o.id)).every((o) => o.printable === false);
  const partSub = (type: PartType): MenuItem => ({
    label: `Add ${PART_LABELS[type].toLowerCase()}`, disabled: !one,
    sub: SHAPES.map(([k, l]) => ({ label: l, onClick: () => one && addPart(one.id, type, k) })),
  });
  const items: MenuItem[] = [
    { label: one ? `Rename “${one.name}”…` : `${ids.length} objects`, disabled: !one, onClick: () => one && renameObject(one.id) },
    { sep: true },
    { label: 'Copy', kbd: 'Ctrl+C', onClick: () => copyObjects(ids) },
    { label: 'Paste', kbd: 'Ctrl+V', disabled: !hasClipboard(), onClick: () => pasteObjects() },
    { label: 'Duplicate', kbd: 'Ctrl+D', onClick: () => cloneObjects(1, ids) },
    { label: 'Clone…', onClick: () => { const n = parseInt(prompt('Number of copies', '2') ?? '', 10); if (n > 0) cloneObjects(Math.min(n, 200), ids); } },
    { label: 'Fill bed with copies', disabled: !one, onClick: () => one && fillBed(one.id) },
    { label: 'Delete', kbd: 'Del', onClick: () => s.removeSelected() },
    { sep: true },
    { label: 'Center on plate', onClick: () => centreObjects(ids) },
    { label: 'Drop to bed', onClick: () => dropObjects(ids) },
    { label: 'Auto orient', kbd: 'O', onClick: () => autoOrient(ids) },
    { label: 'Mirror', sub: [{ label: 'Along X', onClick: () => mirrorObjects(0, ids) }, { label: 'Along Y', onClick: () => mirrorObjects(1, ids) }, { label: 'Along Z', onClick: () => mirrorObjects(2, ids) }] },
    { label: 'Split to objects', disabled: !one, onClick: () => one && splitObject(one.id) },
    { sep: true },
    { label: 'Filament', sub: s.filaments.map((f, k) => ({ label: `Filament ${k + 1}`, swatch: f.color, checked: !!one && (one.filament ?? 0) === k, onClick: () => setObjectFilament(k, ids) })) },
    { label: 'Printable', checked: printable, onClick: () => togglePrintable(ids) },
    ...(s.plates.length > 1 ? [{ label: 'Move to plate', sub: s.plates.map((p, k) => ({ label: p.name, disabled: k === m.plate, onClick: () => { s.set({ selected: ids }); moveToPlate(k); } })) }] : []),
    { sep: true },
    partSub('negative'),
    partSub('modifier'),
    partSub('support_enforcer'),
    partSub('support_blocker'),
    { sep: true },
    { label: 'Paint support', kbd: 'L', onClick: () => s.set({ selected: ids, tool: 'paint_support' }) },
    { label: 'Paint seam', kbd: 'P', onClick: () => s.set({ selected: ids, tool: 'paint_seam' }) },
    { label: 'Paint colour', kbd: 'N', disabled: s.filaments.length < 2, onClick: () => s.set({ selected: ids, tool: 'paint_color' }) },
    { label: 'Cut', kbd: 'C', disabled: !one, onClick: () => s.set({ selected: ids, tool: 'cut' }) },
  ];
  if (s.plugins.includes('motionex')) items.push({ label: 'Motionex pattern on whole object', onClick: () => applyPatternToObjects(ids) });
  items.push({ sep: true }, { label: 'Export as STL…', onClick: () => exportStl(ids) });
  return items;
}

function partItems(m: ContextMenuState): MenuItem[] {
  const s = useStore.getState();
  return [
    { label: 'Delete part', kbd: 'Del', onClick: () => { s.set({ selected: [m.id!], selectedPart: m.partId! }); useStore.getState().removeSelected(); } },
    { label: 'Move', kbd: 'M', onClick: () => s.set({ tool: 'move' }) },
    { label: 'Rotate', kbd: 'R', onClick: () => s.set({ tool: 'rotate' }) },
    { label: 'Scale', kbd: 'S', onClick: () => s.set({ tool: 'scale' }) },
    { label: 'Edit settings', onClick: () => s.set({ processMode: 'objects' }) },
  ];
}

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!menu) return;
    const close = () => set({ contextMenu: null });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); window.removeEventListener('resize', close); };
  }, [menu, set]);
  if (!menu) return null;
  const items = menu.kind === 'plate' ? plateItems(menu) : menu.kind === 'part' ? partItems(menu) : objectItems(menu);
  return <MenuList items={items} x={menu.x} y={menu.y} onDone={() => set({ contextMenu: null })} />;
}

function MenuList({ items, x, y, onDone }: { items: MenuItem[]; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);
  const [subAt, setSubAt] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
  }, [x, y]);
  return (
    <>
      <div ref={ref} className="menu-pop ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, k) => it.sep ? <div key={k} className="ctx-sep" /> : (
          <button key={k} role="menuitem" className={`menu-item ${open === k ? 'open' : ''}`} disabled={it.disabled}
            onPointerEnter={(e) => { if (it.sub) { const r = e.currentTarget.getBoundingClientRect(); setSubAt({ x: r.right + 2, y: r.top - 6 }); setOpen(k); } else setOpen(null); }}
            onClick={() => { if (it.sub) return; it.onClick?.(); onDone(); }}>
            <span className="ctx-label">
              <span className="ctx-check">{it.checked ? '✓' : ''}</span>
              {it.swatch && <i className="ctx-swatch" style={{ background: it.swatch }} />}
              {it.label}
            </span>
            {it.sub ? <span className="ctx-arrow">›</span> : it.kbd ? <kbd>{it.kbd}</kbd> : null}
          </button>
        ))}
      </div>
      {open !== null && items[open]?.sub && !items[open].disabled && <MenuList key={open} items={items[open].sub!} x={subAt.x} y={subAt.y} onDone={onDone} />}
    </>
  );
}
