// Where each plugin's big editor (its "Studio") opens. Clicking a plugin on the left rail never jumps there:
// it opens the plugin's settings bar beside the print settings, and the bar has an "Open Studio" button.
import { openStudio as openLumonex } from './lumonex/ui/state';
import { openStudio as openClickex } from './clickex/ui/state';
import { openStudio as openFlenex } from './flenex/ui/state';
import { PLUGINS } from './registry';
import { openMotionStudio } from './motionex/ui/studioWindow';

const STUDIOS: Record<string, { label: string; open: () => void; about: string }> = {
  motionex: { label: 'Motion Studio', open: () => openMotionStudio(true), about: 'Full-height editor for one motion: its shape, depth, spacing and how layers stack, with close-ups.' },
  lumonex: { label: 'Lumonex Studio', open: () => openLumonex(true), about: 'Full-screen lamp designer.' },
  clickex: { label: 'Clickex Studio', open: () => openClickex(true), about: 'Full-screen snap-fit and joint designer.' },
  flenex: { label: 'Flenex Studio', open: () => openFlenex(true), about: 'Full-screen flexure designer.' },
};

/** The plugin's Studio, or null when it only has its settings bar. */
export function studioOf(id: string) {
  const s = STUDIOS[id];
  return s && PLUGINS.some((p) => p.id === id) ? s : null;
}
