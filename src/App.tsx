import { useEffect, useState } from 'react';
import { PluginsButton, RightDock } from './ui/RightDock';
import { arrange, autoOrient, exportGcode, importBuffers, importDialog, newProject, sliceAndPreview } from './state/actions';
import { useStore, type Workspace } from './state/store';
import { Icon } from './ui/icons';
import { CalibrationPage, HomePage, ProjectPage } from './ui/Pages';
import { DevicePage } from './ui/DevicePage';
import { BooleanPanel, CutPanel, MeasurePanel, TextPanel } from './ui/ToolPanels';
import { PrintDialogHost, openPrintDialog } from './ui/PrintModal';
import { exportPlateFile } from './state/printjob';
import { openProjectDialog, saveProject } from './state/project';
import { ActionBar, EmptyHint, PaintPanel, PlateBar, Toolbar, TransformPanel, ViewCube, VlhPanel } from './ui/PrepareOverlays';
import { LayerSlider, Legend, MoveSlider, PreviewEmpty, SliceProgress } from './ui/PreviewOverlays';
import { Sidebar } from './ui/Sidebar';
import { Viewport, viewApi } from './viewport/Viewport';

const TABS: { id: Workspace; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'prepare', label: 'Prepare', icon: 'cube' },
  { id: 'preview', label: 'Preview', icon: 'layers' },
  { id: 'device', label: 'Device', icon: 'device' },
  { id: 'project', label: 'Project', icon: 'folder' },
  { id: 'calibration', label: 'Calibration', icon: 'calib' },
];

function FileMenu() {
  const [open, setOpen] = useState(false);
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
        File<Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {item('New project', 'Ctrl+N', newProject)}
          {item('Import STL / OBJ / 3MF…', 'Ctrl+I', importDialog)}
          {item('Slice plate', 'Ctrl+R', sliceAndPreview, !objects.length)}
          {item('Export G-code…', 'Ctrl+G', exportGcode, !objects.length)}
          {item('Export plate as .gcode.3mf…', '', () => exportPlateFile('3mf'), !objects.length)}
          {item('Print plate…', 'Ctrl+P', openPrintDialog, !objects.length)}
          <div className="sep" style={{ width: '100%', height: 1, margin: '4px 0' }} />
          {item('Open project (.3mf)…', 'Ctrl+O', openProjectDialog)}
          {item('Save project…', 'Ctrl+S', saveProject, !objects.length)}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { workspace, set, theme, undo, redo, undoStack, redoStack } = useStore();
  return (
    <header className="topbar">
      <div className="brand"><img src={theme === 'dark' ? './logo-dark.svg' : './logo-light.svg'} alt="" />NexSpiro</div>
      <FileMenu />
      <button className="icon-btn" title="Import model (Ctrl+I)" aria-label="Import" onClick={importDialog}><Icon name="open" /></button>
      <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Icon name="undo" /></button>
      <button className="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Icon name="redo" /></button>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={workspace === t.id} className={`tab ${workspace === t.id ? 'active' : ''}`} onClick={() => set({ workspace: t.id })}>
            {t.label}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      <PluginsButton />
      <button className="icon-btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-label="Toggle theme" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </header>
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
      if (mod && k >= '1' && k <= '5') { s.set({ workspace: (['prepare', 'preview', 'device', 'project', 'calibration'] as Workspace[])[+k - 1] }); e.preventDefault(); return; }
      if (mod && k === 'z') { e.shiftKey ? s.redo() : s.undo(); e.preventDefault(); return; }
      if (mod && k === 'y') { s.redo(); e.preventDefault(); return; }
      if (mod && k === 'i') { importDialog(); e.preventDefault(); return; }
      if (mod && k === 'n') { newProject(); e.preventDefault(); return; }
      if (mod && k === 'r') { sliceAndPreview(); e.preventDefault(); return; }
      if (mod && k === 'g') { exportGcode(); e.preventDefault(); return; }
      if (mod && k === 'p') { void openPrintDialog(); e.preventDefault(); return; }
      if (mod && k === 's') { void saveProject(); e.preventDefault(); return; }
      if (mod && k === 'o') { void openProjectDialog(); e.preventDefault(); return; }
      if (mod && k === 'f') { s.set({ workspace: 'prepare' }); setTimeout(() => document.getElementById('param-search')?.focus(), 0); e.preventDefault(); return; }
      if (s.workspace !== 'prepare') return;
      if (mod && k === 'a') { s.set({ selected: s.objects.map((o) => o.id) }); e.preventDefault(); return; }
      if (mod && k === 'd') { s.duplicateSelected(); e.preventDefault(); return; }
      if (mod) return;
      if (k === 'delete' || k === 'backspace') s.removeSelected();
      else if (k === 'escape') s.set({ selected: [], selectedPart: null, tool: 'select' });
      else if (k === 'l') s.set({ tool: s.tool === 'paint_support' ? 'select' : 'paint_support' });
      else if (k === 'p') s.set({ tool: s.tool === 'paint_seam' ? 'select' : 'paint_seam' });
      else if (k === 'n') s.set({ tool: s.tool === 'paint_color' ? 'select' : 'paint_color' });
      else if (k === 'h') s.set({ tool: s.tool === 'vlh' ? 'select' : 'vlh' });
      else if (k === 'c') s.set({ tool: s.tool === 'cut' ? 'select' : 'cut' });
      else if (k === 't') s.set({ tool: s.tool === 'text' ? 'select' : 'text' });
      else if (k === 'u') s.set({ tool: s.tool === 'measure' ? 'select' : 'measure', measurePoints: [] });
      else if (k === 'b') s.set({ tool: s.tool === 'boolean' ? 'select' : 'boolean' });
      else if (s.tool === 'paint_color' && k >= '1' && k <= '9' && +k <= s.filaments.length) s.set({ paintColor: +k });
      else if (k === 'm') s.set({ tool: s.tool === 'move' ? 'select' : 'move' });
      else if (k === 'r') s.set({ tool: s.tool === 'rotate' ? 'select' : 'rotate' });
      else if (k === 's') s.set({ tool: s.tool === 'scale' ? 'select' : 'scale' });
      else if (k === 'f') s.set({ tool: s.tool === 'face' ? 'select' : 'face' });
      else if (k === 'a') arrange();
      else if (k === 'o') autoOrient();
      else if (k === '0') viewApi.current?.setView('iso');
      else if (k === '1') viewApi.current?.setView('top');
      else if (k === '2') viewApi.current?.setView('front');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const { theme, workspace } = useStore();
  const [dragOver, setDragOver] = useState(false);
  useShortcuts();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const is3d = workspace === 'prepare' || workspace === 'preview';
  const hasDock = useStore((s) => s.plugins.length > 0);

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
      <div className="workspace" style={is3d ? { gridTemplateColumns: hasDock ? 'var(--sidebar-w, 360px) 1fr auto' : undefined } : { gridTemplateColumns: '1fr' }}>
        {is3d && <Sidebar />}
        <main className="stage" style={is3d ? undefined : { display: 'none' }}>
          <Viewport />
          {workspace === 'prepare' && <><Toolbar /><TransformPanel /><PaintPanel /><VlhPanel /><CutPanel /><BooleanPanel /><TextPanel /><MeasurePanel /><PlateBar /><EmptyHint /><ActionBar /></>}
          {workspace === 'preview' && <><Legend /><LayerSlider /><MoveSlider /><PreviewEmpty /></>}
          <ViewCube />
          <SliceProgress />
          {dragOver && <div className="dropzone">Drop to add to plate</div>}
        </main>
        {is3d && <RightDock />}
        {workspace === 'home' && <HomePage />}
        {workspace === 'device' && <DevicePage />}
        {workspace === 'project' && <ProjectPage />}
        {workspace === 'calibration' && <CalibrationPage />}
      </div>
      <Toast />
      <PrintDialogHost />
    </div>
  );
}
