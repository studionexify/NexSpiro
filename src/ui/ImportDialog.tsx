// Import feedback: a "Loading file…" window with a progress bar and Cancel while a model or project is read,
// and the "this file is for another printer" question (Switch now / Keep current / Cancel), like Bambu Studio.
import { create } from 'zustand';

type Choice = 'switch' | 'keep' | 'cancel';
interface ImportUi {
  loading: { name: string; progress: number; stage: string } | null;
  cancelled: boolean;
  ask: { file: string; fileModel: string; current: string; resolve: (c: Choice) => void } | null;
}
export const useImportUi = create<ImportUi>(() => ({ loading: null, cancelled: false, ask: null }));

/** Starts the loading window for a file. */
export function importStart(name: string) { useImportUi.setState({ loading: { name, progress: 0, stage: 'Opening' }, cancelled: false }); }
/** Updates the bar and lets the browser paint it. */
export async function importProgress(progress: number, stage: string) {
  const l = useImportUi.getState().loading;
  if (l) useImportUi.setState({ loading: { ...l, progress, stage } });
  await new Promise((r) => setTimeout(r, 0));
}
export function importDone() { useImportUi.setState({ loading: null }); }
export const importCancelled = () => useImportUi.getState().cancelled;

/** Asks whether to switch to the printer the file was made for. */
export function askPrinterSwitch(file: string, fileModel: string, current: string): Promise<Choice> {
  return new Promise((resolve) => useImportUi.setState({ ask: { file, fileModel, current, resolve: (c) => { useImportUi.setState({ ask: null }); resolve(c); } } }));
}

export function ImportDialogHost() {
  const { loading, ask, cancelled } = useImportUi();
  if (ask) return (
    <div className="imp-back" role="dialog" aria-modal="true" aria-label="Printer of the file">
      <div className="imp-win">
        <div className="imp-head">Different printer<button className="imp-x" aria-label="Cancel" onClick={() => ask.resolve('cancel')}>×</button></div>
        <div className="imp-body">
          <p><b>{ask.file}</b> was made for the <b>{ask.fileModel}</b>. The plate is set up for the <b>{ask.current}</b>.</p>
          <p className="imp-muted">Switch to keep the file's plates and positions exactly as they were made. Keep current places the objects on this printer's plates instead.</p>
        </div>
        <div className="imp-foot">
          <button className="btn-secondary" onClick={() => ask.resolve('cancel')}>Cancel</button>
          <button className="btn-secondary" onClick={() => ask.resolve('keep')}>Keep {ask.current}</button>
          <button className="btn-primary" onClick={() => ask.resolve('switch')} autoFocus>Switch to {ask.fileModel}</button>
        </div>
      </div>
    </div>
  );
  if (!loading) return null;
  return (
    <div className="imp-back" role="dialog" aria-modal="true" aria-label="Loading">
      <div className="imp-win">
        <div className="imp-head">Loading…</div>
        <div className="imp-body">
          <p>Loading file: <b>{loading.name}</b></p>
          <div className="imp-bar"><i style={{ width: `${Math.round(Math.max(0.03, loading.progress) * 100)}%` }} /></div>
          <p className="imp-muted">{cancelled ? 'Cancelling…' : loading.stage}</p>
        </div>
        <div className="imp-foot"><button className="btn-secondary" disabled={cancelled} onClick={() => useImportUi.setState({ cancelled: true })}>Cancel</button></div>
      </div>
    </div>
  );
}
