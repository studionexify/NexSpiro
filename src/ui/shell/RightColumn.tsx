// Right column: the inspector (printer, filament, preset, process tabs and the tabs of the plugins turned on in File → Plugins).
import { Inspector } from '../inspector/Inspector';

export function RightColumn() {
  return (
    <aside className="sh-right" aria-label="Inspector">
      <div className="sh-inspector"><Inspector /></div>
    </aside>
  );
}
