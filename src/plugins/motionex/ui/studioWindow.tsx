// Motion Studio as a full-window editor over NexSpiro, opened from the Motionex settings bar like the other
// plugins' Studios. Closing it returns to the model.
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { useStore } from '../../../state/store';
import { MotionStudio } from './MotionStudio';

let isOpen = false;
const listeners = new Set<() => void>();
export function openMotionStudio(open = true) { isOpen = open; listeners.forEach((l) => l()); }
const useOpen = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => isOpen);

export function MotionStudioHost() {
  const open = useOpen();
  const installed = useStore((s) => s.plugins.includes('motionex'));
  if (!open || !installed || typeof document === 'undefined') return null;
  return createPortal(
    <div className="mxw-back" role="dialog" aria-label="Motion Studio" onMouseDown={(e) => { if (e.target === e.currentTarget) openMotionStudio(false); }}>
      <div className="mxw">
        <header className="mxw-head">
          <b>Motion Studio</b>
          <span className="mx-muted" style={{ flex: 1, margin: 0 }}>Edit one motion in detail: shape, depth, spacing and how layers stack.</span>
          <button className="btn-primary btn-small" onClick={() => openMotionStudio(false)}>Done</button>
        </header>
        <div className="mxw-body"><MotionStudio /></div>
      </div>
    </div>, document.body);
}
