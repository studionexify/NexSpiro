// Right column (356px): inspector on top, action dock pinned at the bottom.
import { Inspector } from '../inspector/Inspector';
import { ActionDock } from './ActionDock';

export function RightColumn() {
  return (
    <aside className="sh-right" aria-label="Inspector">
      <div className="sh-inspector"><Inspector /></div>
      <ActionDock />
    </aside>
  );
}
