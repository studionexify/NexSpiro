// Right column (356px): inspector on top, action dock pinned at the bottom. While a plugin's settings bar
// is open the column can be folded into a slim strip, so the plugin gets the room.
import { Inspector } from '../inspector/Inspector';
import { ActionDock } from './ActionDock';
import { useStore } from '../../state/store';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';

/** True when the print settings are folded away: only while a plugin's settings bar is open beside them. */
export const useInspectorFolded = () => {
  const open = useStore((s) => s.plugins.length > 0 && s.dock.open);
  return useUi((u) => u.inspectorCollapsed) && open;
};

export function RightColumn() {
  const open = useStore((s) => s.plugins.length > 0 && s.dock.open);
  const folded = useInspectorFolded();
  const set = useUi((u) => u.set);
  if (folded) {
    return (
      <aside className="sh-right sh-right-folded" aria-label="Print settings (hidden)">
        <button className="sh-fold" onClick={() => set({ inspectorCollapsed: false })} title="Show the print settings" aria-label="Show the print settings">
          <Icon name="chevron" size={14} /><span>Print settings</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className="sh-right" aria-label="Inspector">
      {open && (
        <button className="sh-fold-bar" onClick={() => set({ inspectorCollapsed: true })} title="Hide the print settings so the plugin has the room" aria-label="Hide the print settings">
          <span>Print settings</span><span className="sh-fold-x">Hide ›</span>
        </button>
      )}
      <div className="sh-inspector"><Inspector /></div>
      <ActionDock />
    </aside>
  );
}
