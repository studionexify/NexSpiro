// Right-hand plugin dock (like Blender's side panel): one tab per installed plugin, collapses to a
// thin strip on the right edge, and can be resized by dragging its left edge.
import { useState } from 'react';
import { useStore } from '../state/store';
import { PLUGINS } from '../plugins/registry';
import { Modal } from './Modals';

export function RightDock() {
  const { plugins, dock, set } = useStore();
  const installed = PLUGINS.filter((p) => plugins.includes(p.id));
  if (!installed.length) return null;
  const active = installed.find((p) => p.id === dock.tab) ?? installed[0];
  const setDock = (d: Partial<typeof dock>) => set({ dock: { ...useStore.getState().dock, ...d } });

  if (!dock.open) {
    return (
      <aside className="dock collapsed" aria-label="Plugins">
        {installed.map((p) => (
          <button key={p.id} className="dock-strip-tab" title={`Open ${p.name}`} onClick={() => setDock({ open: true, tab: p.id })}>
            <span className="mx-badge sm">{p.badge}</span><span className="dock-strip-label">{p.name}</span>
          </button>
        ))}
      </aside>
    );
  }
  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = dock.width;
    const move = (ev: PointerEvent) => setDock({ width: Math.max(260, Math.min(640, w0 + (x0 - ev.clientX))) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const Panel = active.Panel;
  return (
    <aside className="dock" style={{ width: dock.width }} aria-label="Plugins">
      <div className="dock-resize" onPointerDown={startResize} title="Drag to resize" />
      <div className="dock-tabs">
        {installed.map((p) => (
          <button key={p.id} className={`dock-tab ${p.id === active.id ? 'on' : ''}`} onClick={() => setDock({ tab: p.id })}>{p.name}</button>
        ))}
        <span className="spacer" />
        <button className="icon-btn" title="Collapse panel" aria-label="Collapse panel" onClick={() => setDock({ open: false })}>›</button>
      </div>
      <div className="dock-body"><Panel /></div>
    </aside>
  );
}

export function PluginsButton() {
  const [open, setOpen] = useState(false);
  const { plugins, set, markDirty } = useStore();
  const toggle = (id: string) => {
    const on = plugins.includes(id);
    set({ plugins: on ? plugins.filter((x) => x !== id) : [...plugins, id], dock: { ...useStore.getState().dock, open: true, tab: id } });
    markDirty();
  };
  return (
    <>
      <button className="btn-secondary btn-small" title="Plugins" onClick={() => setOpen(true)}>Plugins{plugins.length ? ` (${plugins.length})` : ''}</button>
      {open && (
        <Modal title="Plugins" onClose={() => setOpen(false)}>
          <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>Plugins change the toolpaths after slicing. NexSpiro always writes the final G-code.</p>
          {PLUGINS.map((p) => {
            const on = plugins.includes(p.id);
            return (
              <div key={p.id} className="plugin-row">
                <span className="mx-badge">{p.badge}</span>
                <div style={{ flex: 1 }}><strong>{p.name}</strong><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.description}</div></div>
                <button className={on ? 'btn-secondary btn-small' : 'btn-primary btn-small'} onClick={() => toggle(p.id)}>{on ? 'Remove' : 'Install'}</button>
              </div>
            );
          })}
        </Modal>
      )}
    </>
  );
}
