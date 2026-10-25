// Left rail (56px): modes, pinned plugins, plugin manager, and secondary workspaces.
import { useState } from 'react';
import { useStore, type Workspace } from '../../state/store';
import { useUi } from '../../state/ui';
import { PLUGINS } from '../../plugins/registry';
import { Icon } from '../icons';
import { PluginManager } from '../RightDock';

export const PLUGIN_COLORS: Record<string, string> = {
  motionex: '#8B5CF6', patternex: '#0EA5E9', hanex: '#F97316', bulnex: '#14B8A6',
  plantex: '#22C55E', lumonex: '#EAB308', clickex: '#EC4899', flenex: '#6366F1',
};

/**
 * Opens a plugin's settings bar (the dock beside the print settings). It never jumps to a Studio or another
 * tab: the bar has an "Open Studio" button for plugins that have one. Clicking the open plugin again closes the bar.
 */
export function openPlugin(id: string) {
  const s = useStore.getState();
  const p = PLUGINS.find((x) => x.id === id);
  if (!p || !s.plugins.includes(id)) return;
  const on3d = s.workspace === 'prepare' || s.workspace === 'preview';
  const same = on3d && s.dock.open && s.dock.tab === id;
  s.set({ dock: { ...s.dock, open: !same, tab: id }, workspace: on3d ? s.workspace : 'prepare' });
}

function RB({ on, title, onClick, children, cls = '' }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; cls?: string }) {
  return (
    <button className={`sh-rb ${on ? 'on' : ''} ${cls}`} aria-label={title} aria-pressed={on} onClick={onClick}>
      {children}<span className="sh-tip">{title}</span>
    </button>
  );
}

export function Rail() {
  const { workspace, set, theme, plugins, dock } = useStore();
  const pinned = useUi((s) => s.pinnedPlugins);
  const [mgr, setMgr] = useState(false);
  const go = (w: Workspace) => set({ workspace: w });
  const mode = (w: Workspace, icon: string, label: string) => (
    <RB on={workspace === w} title={label} onClick={() => go(w)}><Icon name={icon} size={18} /></RB>
  );
  const shown = PLUGINS.filter((p) => pinned.includes(p.id) && plugins.includes(p.id));
  return (
    <nav className="sh-rail" aria-label="Workspace">
      <div className="sh-logo"><img src={theme === 'dark' ? './logo-dark.svg' : './logo-light.svg'} alt="NexSpiro" /></div>
      {mode('prepare', 'cube', 'Prepare')}
      {mode('preview', 'layers', 'Preview')}
      {mode('device', 'device', 'Device')}
      <div className="sh-rail-sep" />
      {shown.length > 0 && <div className="sh-rail-lbl">Pinned</div>}
      {shown.map((p) => {
        const isOpen = dock.open && dock.tab === p.id && (workspace === 'prepare' || workspace === 'preview');
        return (
          <RB key={p.id} cls={isOpen ? 'open' : ''} title={`${p.name} · settings`} onClick={() => openPlugin(p.id)}>
            <span className="sh-ini" style={{ background: PLUGIN_COLORS[p.id] ?? 'var(--ns-active, var(--accent))' }}>{p.badge}</span>
          </RB>
        );
      })}
      <RB title="All plugins · install, pin / unpin" onClick={() => setMgr(true)}><Icon name="add" size={18} /></RB>
      {/* Home, Project, Calibration and the theme live in the View / Tools menus */}
      {mgr && <PluginManager onClose={() => setMgr(false)} />}
    </nav>
  );
}
