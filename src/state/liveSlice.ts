// Live toolpath in Prepare: while it is switched on, the active plate is re-sliced in the background
// shortly after each change, and the viewport draws the new walls on the model.
import { plateObjects, sliceNow } from './slicing';
import { useStore } from './store';

const DELAY_MS = 700;
let timer: ReturnType<typeof setTimeout> | null = null;

function wanted() {
  const s = useStore.getState();
  return s.liveToolpaths && s.workspace === 'prepare' && plateObjects(s.activePlate).some((o) => o.printable !== false);
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const s = useStore.getState();
    if (!wanted()) return;
    // never cut short a slice the user started; try again once it is done
    if (s.slice.status === 'slicing') { if (!s.slice.background) return schedule(); }
    const stale = s.slice.dirty || !s.slice.result || s.slice.plate !== s.activePlate;
    if (stale) void sliceNow({ background: true });
  }, DELAY_MS);
}

export function startLiveSlicing() {
  useStore.subscribe((s, prev) => {
    const turnedOn = (s.liveToolpaths && !prev.liveToolpaths) || (s.workspace === 'prepare' && prev.workspace !== 'prepare');
    const changed = s.slice.dirty && (!prev.slice.dirty || s.objects !== prev.objects);
    const finished = prev.slice.status === 'slicing' && s.slice.status !== 'slicing' && s.slice.dirty;
    if ((turnedOn || changed || finished || s.activePlate !== prev.activePlate) && wanted()) schedule();
  });
}
