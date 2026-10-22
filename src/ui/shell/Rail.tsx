// Left rail (56px): modes, pinned plugins, plugin manager, and secondary workspaces.
import { useState } from 'react';
import { useStore, type Workspace } from '../../state/store';
import { useUi } from '../../state/ui';
import { PLUGINS } from '../../plugins/registry';
import { openStudio as openLumonex } from '../../plugins/lumonex/ui/state';
import { openStudio as openClickex } from '../../plugins/clickex/ui/state';
import { openStudio as openFlenex } from '../../plugins/flenex/ui/state';
import { Icon } from '../icons';
import { PluginManager } from '../RightDock';

export const PLUGIN_COLORS: Record<string, string> = {
  motionex: '#8B5CF6', patternex: '#0EA5E9', hanex: '#F97316', bulnex: '#14B8A6',
  plantex: '#22C55E', lumonex: '#EAB308', clickex: '#EC4899', flenex: '#6366F1',
};

/** Plugins whose Studio opens as a full-screen overlay. */
const OVERLAY_STUDIOS: Record<string, () => void> = { lumonex: () => openLumonex(true), clickex: () => openClickex(true), flenex: () => openFlenex(true) };

/** Opens a plugin: its Studio when it has one, otherwise its panel in the plugin dock (toggles when already open). */
export function openPlugin(id: string) {
  const s = useStore.getState();
  const p = PLUGINS.find((x) => x.id === id);
  if (!p || !s.plugins.includes(id)) return;
  if (OVERLAY_STUDIOS[id]) { OVERLAY_STUDIOS[id](); return; }
  if (p.Studio) { s.set({ workspace: 'motion' }); return; }
  const same = s.dock.open && s.dock.tab === id;
  s.set({ dock: { ...s.dock, open: !same, tab: id }, workspace: s.workspace === 'prepare' || s.workspace === 'preview' ? s.workspace : 'prepare' });
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
  const hasStudio = PLUGINS.some((p) => p.Studio && plugins.includes(p.id));
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
      {hasStudio && mode('motion', 'wave', 'Motion')}
      {mode('device', 'device', 'Device')}
      <div className="sh-rail-sep" />
      {shown.length > 0 && <div className="sh-rail-lbl">Pinned</div>}
      {shown.map((p) => {
        const isOpen = (dock.open && dock.tab === p.id && (workspace === 'prepare' || workspace === 'preview')) || (!!p.Studio && workspace === 'motion');
        const studio = !!p.Studio || !!OVERLAY_STUDIOS[p.id];
        return (
          <RB key={p.id} cls={isOpen ? 'open' : ''} title={`${p.name}${studio ? ' Studio ↗' : ''}`} onClick={() => openPlugin(p.id)}>
            <span className="sh-ini" style={{ background: PLUGIN_COLORS[p.id] ?? 'var(--ns-active, var(--accent))' }}>{p.badge}</span>
          </RB>
        );
      })}
      <RB title="All plugins · install, pin / unpin" onClick={() => setMgr(true)}><Icon name="add" size={18} /></RB>
      <div className="sh-rail-spacer" />
      {mode('home', 'home', 'Home')}
      {mode('project', 'folder', 'Project')}
      {mode('calibration', 'calib', 'Calibration')}
      <RB title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </RB>
      {mgr && <PluginManager onClose={() => setMgr(false)} />}
    </nav>
  );
}
