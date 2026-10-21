// Bottom of the right column: slice summary, clearance status and the primary Slice / Export CTA.
import { exportGcode, sliceAndPreview } from '../../state/actions';
import { useStore } from '../../state/store';
import { useState } from 'react';
import { autoFixUntilClear, useClearanceStatus, useSliceSummary } from '../../state/ui';
import { Icon } from '../icons';
import { openPrintDialog } from '../PrintModal';

const DOT: Record<string, string> = { collision: 'var(--ns-err, var(--error))', warn: 'var(--ns-warn, var(--warning))', ok: 'var(--ns-ok, var(--success))' };

export function ActionDock() {
  const sum = useSliceSummary();
  const clr = useClearanceStatus();
  const slice = useStore((s) => s.slice);
  const hasWork = useStore((s) => s.objects.length > 0 || !!s.plates[s.activePlate]?.program);
  const busy = slice.status === 'slicing' || sum.status === 'slicing';
  const progress = Math.max(sum.progress, slice.progress);
  const [fixing, setFixing] = useState(false);
  // The check comes from the last slice: a collision blocks Export only while that slice is current. Once the
  // scene changes (Auto-fix, a smaller motion…) the CTA is "Slice plate" again so the check can re-run.
  const collision = clr.state === 'collision' && !clr.stale;
  const ready = sum.ready && !busy;
  const metric = (k: string, v?: string) => (
    <div className="sh-metric"><div className="k">{k}</div><div className={`v ${v ? '' : 'dim'}`}>{v ?? '—'}</div></div>
  );
  let label = 'Slice plate';
  if (busy) label = `Slicing… ${Math.round(progress * 100)}%`;
  else if (collision) label = 'Fix collision to slice';
  else if (ready) label = 'Export G-code';
  const run = () => { if (ready) void exportGcode(); else void sliceAndPreview(); };
  // lowers the motion / weave and re-slices until the print head clears (see autoFixUntilClear)
  const fix = () => { setFixing(true); void autoFixUntilClear().finally(() => setFixing(false)); };
  return (
    <div className="sh-actiondock">
      <div className="sh-metrics">{metric('Time', sum.time)}{metric('Filament', sum.weight)}{metric('Cost', sum.cost)}</div>
      {clr.state !== 'none' && (
        <div className="sh-status" role="status">
          <span className="sh-dot" style={{ background: DOT[clr.state] }} />
          <span className="sh-status-msg">{clr.message}{clr.layers ? <span className="mono"> · L{clr.layers[0]}–{clr.layers[1]}</span> : null}</span>
          {clr.canAutoFix && clr.state !== 'ok' && <button className="sh-fix" onClick={fix} disabled={fixing || busy}>{fixing ? 'Fixing…' : 'Auto-fix'}</button>}
        </div>
      )}
      <div className={`sh-progress ${busy ? 'show' : ''}`}><i style={{ width: `${progress * 100}%` }} /></div>
      <div className="sh-cta-row">
        <button className="sh-cta" disabled={busy || fixing || collision || (!ready && !hasWork)} onClick={run}
          title={collision ? 'The print head would hit the print: use Auto-fix or lower the motion, then slice again' : ready ? 'Export G-code (Ctrl+G)' : 'Slice plate (Ctrl+R)'}>
          <Icon name={ready ? 'download' : 'slice'} size={16} />{label}
        </button>
        <button className="sh-cta-2" disabled={!ready} onClick={() => void openPrintDialog()} title={ready ? 'Print plate (Ctrl+P)' : 'Slice the plate first'}>
          <Icon name="print" size={16} />Print
        </button>
      </div>
    </div>
  );
}
