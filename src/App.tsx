import { Modal } from './ui/Modals';
import { TABLET } from './ui/useMedia';
import { useEffect, useState } from 'react';
import { PluginsButton, RightDock } from './ui/RightDock';
import { autoOrient, exportGcode, importBuffers, importDialog, newProject, sliceAndPreview } from './state/actions';
import { useStore, type Workspace } from './state/store';
import { Icon } from './ui/icons';
import { printerById } from './profiles/printers';
import { CalibrationPage, HomePage, ProjectPage } from './ui/Pages';
import { DevicePage } from './ui/DevicePage';
import { BooleanPanel, CutPanel, MeasurePanel, TextPanel } from './ui/ToolPanels';
import { PrintDialogHost, openPrintDialog } from './ui/PrintModal';
import { exportPlateFile } from './state/printjob';
import { openProjectDialog, saveProject } from './state/project';
import { BrimEarsPanel, LiveChip, ObjectInfo, PaintPanel, Toolbar, TransformPanel, ViewCube, VlhPanel } from './ui/PrepareOverlays';
import { LayerSlider, Legend, MoveSlider, PreviewEmpty, SliceProgress } from './ui/PreviewOverlays';
import { Sidebar } from './ui/Sidebar';
import { ContextMenu } from './ui/ContextMenu';
import { FillBedHost } from './ui/FillBedDialog';
import { PlateList, PlateSettingsHost } from './ui/PlateControls';
import { InstantTooltips } from './ui/Tooltip';
import { arrangeAll, arrangeSelected } from './state/ops';
import { copyObjects, pasteObjects } from './state/objectOps';
import { Viewport, viewApi } from './viewport/Viewport';
import { PLUGINS } from './plugins/registry';
import { LumonexStudioHost } from './plugins/lumonex/ui/Studio';
import { ModeToggle } from './ui/advanced/ModeToggle';
import { AdvPaintPanel } from './ui/advanced/AdvPaintPanel';

const TABS: { id: Workspace; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'prepare', label: 'Prepare', icon: 'cube' },
  { id: 'preview', label: 'Preview', icon: 'layers' },
  { id: 'motion', label: 'Motion', icon: 'brush' },
  { id: 'device', label: 'Device', icon: 'device' },
  { id: 'project', label: 'Project', icon: 'folder' },
  { id: 'calibration', label: 'Calibration', icon: 'calib' },
];

function FileMenu() {
  const [open, setOpen] = useState(false);
  const sliced = useSliced();
  const { objects } = useStore();
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = (label: string, kbd: string, fn: () => void, disabled = false) => (
    <button className="menu-item" disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setOpen(false); fn(); }}>
      <span>{label}</span><kbd>{kbd}</kbd>
    </button>
  );
  return (
    <div className="menu">
      <button className={`icon-btn ${open ? 'active' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)} aria-haspopup="menu">
        <Icon name="folder" size={18} className="file-icon" /><span className="btn-label">File</span><Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {item('New project', 'Ctrl+N', newProject)}
          {item('Import STL / OBJ / 3MF…', 'Ctrl+I', importDialog)}
          {item('Slice plate', 'Ctrl+R', sliceAndPreview, !objects.length && !useStore.getState().plates[useStore.getState().activePlate]?.program)}
          {item('Export G-code…', 'Ctrl+G', exportGcode, !sliced)}
          {item('Export plate sliced file (.gcode.3mf)…', '', () => exportPlateFile('3mf'), !sliced)}
          {item('Print plate…', 'Ctrl+P', openPrintDialog, !sliced)}
          <div className="sep" style={{ width: '100%', height: 1, margin: '4px 0' }} />
          {item('Open project (.3mf)…', 'Ctrl+O', openProjectDialog)}
          {item('Save project…', 'Ctrl+S', saveProject, !objects.length)}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { workspace, set, theme, undo, redo, undoStack, redoStack, liveToolpaths } = useStore();
  const hasStudio = useStore((s) => PLUGINS.some((p) => p.Studio && s.plugins.includes(p.id)));
  // the tab strip scrolls on tablets: keep the active tab in view when the workspace changes
  useEffect(() => {
    const tab = document.querySelector<HTMLElement>('.tabs .tab[aria-selected="true"]');
    const box = tab?.closest<HTMLElement>('.tb-left');
    if (!tab || !box) return;
    const t = tab.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (t.left < b.left) box.scrollLeft -= b.left - t.left + 8;
    else if (t.right > b.right) box.scrollLeft += t.right - b.right + 8;
  }, [workspace, hasStudio]);
  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="brand"><img src={theme === 'dark' ? './logo-dark.svg' : './logo-light.svg'} alt="" /><span className="brand-name">NexSpiro</span></div>
        <FileMenu />
        <button className="icon-btn tb-import" title="Import model (Ctrl+I)" aria-label="Import" onClick={importDialog}><Icon name="open" /></button>
        <button className="icon-btn tb-undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Icon name="undo" /></button>
        <button className="icon-btn tb-undo" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Icon name="redo" /></button>
        <nav className="tabs" role="tablist">
          {TABS.filter((t) => t.id !== 'motion' || hasStudio).map((t) => (
            <button key={t.id} role="tab" aria-selected={workspace === t.id} title={t.label} aria-label={t.label}
              className={`tab ${workspace === t.id ? 'active' : ''} ${SECONDARY_TABS.has(t.id) ? 'secondary' : ''}`} onClick={() => set({ workspace: t.id })}>
              <Icon name={t.icon} size={15} className="tab-icon" /><span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="tb-center"><ModeToggle /></div>
      <div className="tb-right">
        {(workspace === 'prepare' || workspace === 'motion') && (
          <button className={`btn-secondary btn-small tb-toggle ${liveToolpaths ? 'on' : ''}`} aria-pressed={liveToolpaths}
            title="Toolpath view: draw the walls on the model in their filament colours and motions, instantly, without slicing"
            onClick={() => set({ liveToolpaths: !liveToolpaths })}>
            <span className={`toggle ${liveToolpaths ? 'on' : ''}`} aria-hidden="true" /><span className="tb-label">Toolpath view</span>
          </button>
        )}
        <PluginsButton />
        <button className="icon-btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-label="Toggle theme" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {(workspace === 'prepare' || workspace === 'preview') && <SliceControls />}
      </div>
    </header>
  );
}

/** Tabs that collapse to icons when the header is narrow (the engine toggle keeps the centre). */
const SECONDARY_TABS = new Set<Workspace>(['home', 'motion', 'device', 'project', 'calibration']);

/** True when the active plate has a slice that matches the current scene and settings. */
const useSliced = () => useStore((s) => s.slice.status === 'done' && !!s.slice.result && !s.slice.dirty && s.slice.plate === s.activePlate);

/** Top-right buttons: Slice plate, then Print plate / export, which only work once the plate is sliced. */
function SliceControls() {
  const { slice, objects, printerId } = useStore();
  const sliced = useSliced();
  const hasProgram = useStore((s) => !!s.plates[s.activePlate]?.program);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const isBbl = printerById(printerId).flavor === 'bbl';
  const busy = slice.status === 'slicing';
  const main = isBbl
    ? { label: 'Print plate', run: openPrintDialog }
    : { label: 'Export G-code file', run: exportGcode };
  const item = (label: string, kbd: string, fn: () => void) => (
    <button className="menu-item" disabled={!sliced} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setOpen(false); fn(); }}><span>{label}</span><kbd>{kbd}</kbd></button>
  );
  return (
    <div className="slice-controls">
      <button className="btn-primary slice-btn" disabled={(!objects.length && !hasProgram) || busy} onClick={sliceAndPreview} title="Slice plate (Ctrl+R)">
        <Icon name="slice" size={16} /><span className="btn-label">{busy ? `Slicing… ${Math.round(slice.progress * 100)}%` : <>Slice<span className="btn-more"> plate</span></>}</span>
      </button>
      <div className="split-btn menu">
        <button className="btn-secondary slice-btn" disabled={!sliced} onClick={() => void main.run()}
          title={sliced ? main.label : 'Slice the plate first'}>
          <Icon name={isBbl ? 'print' : 'download'} size={16} /><span className="btn-label">{main.label}</span>
        </button>
        <button className="btn-secondary slice-btn caret" disabled={!sliced} aria-label="More print and export options" title={sliced ? 'More options' : 'Slice the plate first'}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)}><Icon name="chevronDown" size={14} /></button>
        {open && (
          <div className="menu-pop" role="menu" style={{ right: 0, left: 'auto' }}>
            {item('Print plate', 'Ctrl+P', () => void openPrintDialog())}
            {item('Export plate sliced file (.gcode.3mf)', '', () => void exportPlateFile('3mf'))}
            {item('Export G-code file', 'Ctrl+G', exportGcode)}
          </div>
        )}
      </div>
    </div>
  );
}

function Toast() {
  const { toast, set } = useStore();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => set({ toast: null }), toast.kind === 'error' ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [toast, set]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="alert">
      <Icon name={toast.kind === 'info' ? 'info' : 'warn'} />
      <span>{toast.text}</span>
      <button className="icon-btn" onClick={() => set({ toast: null })} aria-label="Dismiss"><Icon name="close" size={14} /></button>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && e.key === 'Tab') {
        // Ctrl+Tab steps through the tab pages
        const tabs: Workspace[] = ['home', 'prepare', 'preview', 'device', 'project', 'calibration'];
        const i = tabs.indexOf(s.workspace);
        s.set({ workspace: tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length] }); e.preventDefault(); return;
      }
      if (mod && k >= '0' && k <= '7') { viewApi.current?.setView((['iso', 'top', 'bottom', 'front', 'back', 'left', 'right', 'iso'] as const)[+k]); e.preventDefault(); return; }
      if (e.key === '?' && !mod) { s.set({ shortcutsOpen: !s.shortcutsOpen }); e.preventDefault(); return; }
      if (mod && k === 'z') { e.shiftKey ? s.redo() : s.undo(); e.preventDefault(); return; }
      if (mod && k === 'y') { s.redo(); e.preventDefault(); return; }
      if (mod && k === 'i') { importDialog(); e.preventDefault(); return; }
      if (mod && k === 'n') { newProject(); e.preventDefault(); return; }
      if (mod && k === 'r') { sliceAndPreview(); e.preventDefault(); return; }
      if (mod && (k === 'g' || k === 'p')) {
        e.preventDefault();
        const sl = s.slice;
        if (!(sl.status === 'done' && sl.result && !sl.dirty && sl.plate === s.activePlate)) { s.set({ toast: { kind: 'info', text: 'Slice the plate first (Ctrl+R), then export or print it.' } }); return; }
        if (k === 'g') exportGcode(); else void openPrintDialog();
        return;
      }
      if (mod && k === 's') { void saveProject(); e.preventDefault(); return; }
      if (mod && k === 'o') { void openProjectDialog(); e.preventDefault(); return; }
      if (mod && k === 'f') { s.set({ workspace: 'prepare' }); setTimeout(() => document.getElementById('param-search')?.focus(), 0); e.preventDefault(); return; }
      if (s.workspace !== 'prepare') return;
      if (mod && k === 'a') { s.set({ selected: s.objects.map((o) => o.id) }); e.preventDefault(); return; }
      if (mod && k === 'd') { s.duplicateSelected(); e.preventDefault(); return; }
      if (mod && k === 'c') { if (s.selected.length) copyObjects(); e.preventDefault(); return; }
      if (mod && k === 'v') { pasteObjects(); e.preventDefault(); return; }
      if (mod) return;
      if (k === 'delete' || k === 'backspace') s.removeSelected();
      else if (k === 'escape') s.set({ selected: [], selectedPart: null, tool: 'select' });
      else if (k === 'l') s.set({ tool: s.tool === 'paint_support' ? 'select' : 'paint_support' });
      else if (k === 'p') s.set({ tool: s.tool === 'paint_seam' ? 'select' : 'paint_seam' });
      else if (k === 'n') s.set({ tool: s.tool === 'paint_color' ? 'select' : 'paint_color' });
      else if (k === 'h') s.set({ tool: s.tool === 'vlh' ? 'select' : 'vlh' });
      else if (k === 'c') s.set({ tool: s.tool === 'cut' ? 'select' : 'cut' });
      else if (k === 't') s.set({ tool: s.tool === 'text' ? 'select' : 'text' });
      else if (k === 'u') s.set({ tool: s.tool === 'measure' ? 'select' : 'measure', measureFeatures: [] });
      else if (k === 'b') s.set({ tool: s.tool === 'boolean' ? 'select' : 'boolean' });
      else if (k === 'e') s.set({ tool: s.tool === 'brim_ears' ? 'select' : 'brim_ears' });
      else if (s.tool === 'paint_color' && k >= '1' && k <= '9' && +k <= s.filaments.length) s.set({ paintColor: +k });
      else if (k === 'm') s.set({ tool: s.tool === 'move' ? 'select' : 'move' });
      else if (k === 'r') s.set({ tool: s.tool === 'rotate' ? 'select' : 'rotate' });
      else if (k === 's') s.set({ tool: s.tool === 'scale' ? 'select' : 'scale' });
      else if (k === 'f') s.set({ tool: s.tool === 'face' ? 'select' : 'face' });
      else if (k === 'a') { if (e.shiftKey) arrangeSelected(); else arrangeAll(); }
      else if (k === 'o') autoOrient();
      else if (k === 'z') viewApi.current?.fit();
      else if (k >= '0' && k <= '6') viewApi.current?.setView((['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'] as const)[+k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const { theme, workspace: ws } = useStore();
  const studio = useStore((s) => PLUGINS.find((p) => p.Studio && s.plugins.includes(p.id))?.Studio);
  // the Motion tab needs a plugin that has one; without it, fall back to Prepare
  const workspace = ws === 'motion' && !studio ? 'prepare' : ws;
  const [dragOver, setDragOver] = useState(false);
  useShortcuts();
  // on tablets the plugin dock starts collapsed so the canvas keeps the space; it opens from its strip
  useEffect(() => {
    const st = useStore.getState();
    if (window.matchMedia(TABLET).matches && st.dock.open) st.set({ dock: { ...st.dock, open: false } });
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const is3d = workspace === 'prepare' || workspace === 'preview';
  const Studio = workspace === 'motion' ? studio : undefined;
  const hasDock = useStore((s) => s.plugins.length > 0);
  const dockOpen = useStore((s) => s.dock.open);
  const wsClass = `workspace ${is3d ? 'ws-3d' : Studio ? 'ws-studio' : 'ws-page'}${is3d && hasDock ? ' has-dock' : ''}${is3d && hasDock && dockOpen ? ' dock-open' : ''}`;
  // panels opening, closing or re-docking changes the stage size: nudge anything that only listens to window resizes
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(id);
  }, [workspace, hasDock, dockOpen]);

  return (
    <div className="app"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault(); setDragOver(false);
        const files = await Promise.all(Array.from(e.dataTransfer.files).map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
        if (files.length) importBuffers(files);
      }}>
      <TopBar />
      <div className={wsClass}>
        {is3d && <Sidebar />}
        <main className="stage" style={is3d || Studio ? undefined : { display: 'none' }}>
          <Viewport />
          {workspace === 'prepare' && <><Toolbar /><TransformPanel /><PaintPanel /><AdvPaintPanel /><VlhPanel /><CutPanel /><BooleanPanel /><TextPanel /><MeasurePanel /><BrimEarsPanel /><PlateList /><ObjectInfo /><LiveChip /></>}
          {workspace === 'preview' && <><Legend /><LayerSlider /><MoveSlider /><PreviewEmpty /></>}
          <ViewCube />
          <SliceProgress />
          {dragOver && <div className="dropzone">Drop to add to plate</div>}
        </main>
        {is3d && <RightDock />}
        {Studio && <Studio />}
        {workspace === 'home' && <HomePage />}
        {workspace === 'device' && <DevicePage />}
        {workspace === 'project' && <ProjectPage />}
        {workspace === 'calibration' && <CalibrationPage />}
      </div>
      <Toast />
      <ContextMenu />
      <PrintDialogHost />
      <PlateSettingsHost />
      <FillBedHost />
      <LumonexStudioHost />
      <InstantTooltips />
      <ShortcutsHost />
    </div>
  );
}

/** Keyboard shortcuts list (opened with ?). */
const SHORTCUTS: [string, [string, string][]][] = [
  ['Global', [['Ctrl+N', 'New project'], ['Ctrl+O', 'Open project'], ['Ctrl+S', 'Save project'], ['Ctrl+I', 'Import model'], ['Ctrl+R', 'Slice plate'],
    ['Ctrl+G', 'Export G-code'], ['Ctrl+P', 'Print plate'], ['Ctrl+F', 'Search settings'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+Tab', 'Next tab page (Shift: previous)'], ['Shift+?', 'Show this list']]],
  ['Camera', [['Ctrl+0', 'Default view'], ['Ctrl+1', 'Top view'], ['Ctrl+2', 'Bottom view'], ['Ctrl+3', 'Front view'], ['Ctrl+4', 'Rear view'], ['Ctrl+5', 'Left view'], ['Ctrl+6', 'Right view'], ['Ctrl+7', 'Isometric view'], ['Z', 'Fit to scene or selection']]],
  ['Prepare', [['Ctrl+A', 'Select all'], ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+D', 'Duplicate'], ['Del', 'Delete selection'], ['Esc', 'Clear selection / leave tool'],
    ['A / Shift+A', 'Arrange all / selection'], ['O', 'Auto orient'], ['M', 'Move'], ['R', 'Rotate'], ['S', 'Scale'], ['F', 'Lay on face'], ['C', 'Cut'], ['B', 'Boolean'],
    ['L', 'Support painting'], ['P', 'Seam painting'], ['N', 'Colour painting'], ['1…9', 'Paint filament (colour painting)'], ['H', 'Variable layer height'], ['T', 'Text'], ['U', 'Measure'], ['E', 'Brim ears'],
    ['Shift (rotate)', 'Snap to 5° ticks; outer ring snaps to 45°']]],
  ['Preview', [['↑ / ↓', 'Layer up / down'], ['← / →', 'Move slider back / forward'], ['L', 'Show one layer only']]],
];

function ShortcutsHost() {
  const { shortcutsOpen, set } = useStore();
  if (!shortcutsOpen) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => set({ shortcutsOpen: false })}>
      <div className="shortcut-cols">
        {SHORTCUTS.map(([g, rows]) => (
          <div key={g}>
            <div className="group-title">{g}</div>
            {rows.map(([k, l]) => <div key={k + l} className="shortcut-row"><kbd>{k}</kbd><span>{l}</span></div>)}
          </div>
        ))}
      </div>
    </Modal>
  );
}
