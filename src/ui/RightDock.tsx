// Right-hand plugin dock (like Blender's side panel): one tab per installed plugin, collapses to a
// thin strip on the right edge, and can be resized by dragging its left edge.
import { useState } from 'react';
import { useStore } from '../state/store';
import { PLUGINS } from '../plugins/registry';
import { Modal } from './Modals';
import { useUi } from '../state/ui';

export function RightDock() {
  const { plugins, dock, set } = useStore();
  const installed = PLUGINS.filter((p) => plugins.includes(p.id));
  if (!installed.length) return null;
  const active = installed.find((p) => p.id === dock.tab) ?? installed[0];
  const setDock = (d: Partial<typeof dock>) => set({ dock: { ...useStore.getState().dock, ...d } });

  // closed: nothing on the right; the left rail opens plugins
  if (!dock.open) return null;
  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = dock.width;
    const move = (ev: PointerEvent) => setDock({ width: Math.max(260, Math.min(640, w0 + (x0 - ev.clientX))) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const Panel = active.Panel;
  return (
    <aside className="dock sh-pdock" style={{ width: dock.width }} aria-label="Plugins">
      <div className="dock-resize" onPointerDown={startResize} title="Drag to resize" />
      <div className="dock-tabs">
        {/* the left rail switches plugins; the header only names the active one */}
        <h2 className="dock-title">{active.name}</h2>
        <span className="spacer" />
        <button className="icon-btn" title="Collapse panel" aria-label="Collapse panel" onClick={() => setDock({ open: false })}>›</button>
      </div>
      <div className="dock-body"><Panel /></div>
    </aside>
  );
}

/** Plugin manager: install / remove every plugin and pin installed ones to the left rail. */
export function PluginManager({ onClose }: { onClose: () => void }) {
  const { plugins, set, markDirty } = useStore();
  const { pinnedPlugins, togglePinPlugin } = useUi();
  const toggle = (id: string) => {
    const on = plugins.includes(id);
    set({ plugins: on ? plugins.filter((x) => x !== id) : [...plugins, id], dock: { ...useStore.getState().dock, open: true, tab: id } });
    // a freshly installed plugin is pinned so it shows on the rail straight away
    if (!on && !useUi.getState().pinnedPlugins.includes(id)) togglePinPlugin(id);
    markDirty();
  };
  return (
    <Modal title="Plugins" onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>Plugins add material regions and change the toolpaths while slicing. NexSpiro always writes the final G-code. Pin a plugin to keep it on the left rail.</p>
      {PLUGINS.map((p) => {
        const on = plugins.includes(p.id);
        const pinned = pinnedPlugins.includes(p.id);
        return (
          <div key={p.id} className="plugin-row">
            <span className="mx-badge">{p.badge}</span>
            <div style={{ flex: 1 }}><strong>{p.name}</strong><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.description}</div></div>
            {on && <button className="btn-secondary btn-small" aria-pressed={pinned} onClick={() => togglePinPlugin(p.id)} title={pinned ? 'Remove from the left rail' : 'Show on the left rail'}>{pinned ? 'Unpin' : 'Pin'}</button>}
            <button className={on ? 'btn-secondary btn-small' : 'btn-primary btn-small'} onClick={() => toggle(p.id)}>{on ? 'Remove' : 'Install'}</button>
          </div>
        );
      })}
    </Modal>
  );
}

export function PluginsButton() {
  const [open, setOpen] = useState(false);
  const plugins = useStore((s) => s.plugins);
  return (
    <>
      <button className="btn-secondary btn-small" title="Plugins" onClick={() => setOpen(true)}>Plugins{plugins.length ? ` (${plugins.length})` : ''}</button>
      {open && <PluginManager onClose={() => setOpen(false)} />}
    </>
  );
}
