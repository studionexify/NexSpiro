import { Modal } from './ui/Modals';
import { useEffect, useState } from 'react';
import { RightDock } from './ui/RightDock';
import { autoOrient, exportGcode, importBuffers, importDialog, newProject, sliceAndPreview } from './state/actions';
import { useUi } from './state/ui';
import { CameraBar, CommandPalette, MenuBar, ObjectPill, Rail, RightColumn, ViewBar } from './ui/shell';
import { useInspectorFolded } from './ui/shell/RightColumn';
import './ui/shell/shell.css';
import { useStore, type Workspace } from './state/store';
import { Icon } from './ui/icons';
import { CalibrationPage, HomePage, ProjectPage } from './ui/Pages';
import { DevicePage } from './ui/DevicePage';
import { BooleanPanel, CutPanel, EdgesPanel, MeasurePanel, TextPanel } from './ui/ToolPanels';
import { PrintDialogHost, openPrintDialog } from './ui/PrintModal';
import { openProjectDialog, saveProject } from './state/project';
import { BrimEarsPanel, LiveChip, ObjectInfo, PaintPanel, Toolbar, TransformPanel, ViewCube, VlhPanel } from './ui/PrepareOverlays';
import { LayerSlider, Legend, MoveSlider, PreviewEmpty, SliceProgress } from './ui/PreviewOverlays';
import { ContextMenu } from './ui/ContextMenu';
import { FillBedHost } from './ui/FillBedDialog';
import { PlateList, PlateSettingsHost } from './ui/PlateControls';
import { InstantTooltips } from './ui/Tooltip';
import { arrangeAll, arrangeSelected } from './state/ops';
import { copyObjects, pasteObjects } from './state/objectOps';
import { cancelSlice } from './state/slicing';
import { Viewport, viewApi } from './viewport/Viewport';
import { PLUGINS } from './plugins/registry';
import { LumonexStudioHost } from './plugins/lumonex/ui/Studio';
import { ClickexStudioHost } from './plugins/clickex/ui/Studio';
import { MotionStudioHost } from './plugins/motionex/ui/studioWindow';
import { FlenexStudioHost } from './plugins/flenex/ui/Studio';
import { AdvPaintPanel } from './ui/advanced/AdvPaintPanel';

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
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        // Ctrl+K: command palette (works from inside text fields too)
        const ui = useUi.getState();
        ui.set({ paletteOpen: !ui.paletteOpen }); e.preventDefault(); return;
      }
      if (useUi.getState().paletteOpen) return;
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
      if (e.key === 'Escape' && s.slice.status === 'slicing') { cancelSlice(); e.preventDefault(); return; }
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
      else if (k === 'g') s.set({ tool: s.tool === 'edges' ? 'select' : 'edges', edgeSel: null });
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
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const is3d = workspace === 'prepare' || workspace === 'preview';
  const Studio = workspace === 'motion' ? studio : undefined;
  const hasDock = useStore((st) => st.plugins.length > 0 && st.dock.open);
  const dockW = useStore((st) => st.dock.width);
  // the work area keeps at least ~62% of the body; the inspector and plugin dock share the rest. With a plugin
  // dock open the dock keeps a usable minimum (300px) so narrow/tablet windows don't crush it to a sliver.
  const folded = useInspectorFolded();
  const right = folded ? '34px' : 'clamp(260px, 22%, 340px)';
  const bodyCols = is3d ? (hasDock ? `minmax(0, 1fr) minmax(${Math.min(300, dockW)}px, ${dockW}px) ${right}` : `minmax(62%, 1fr) ${right}`) : Studio ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)';

  return (
    <div className="app sh-app"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault(); setDragOver(false);
        const files = await Promise.all(Array.from(e.dataTransfer.files).map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
        if (files.length) importBuffers(files);
      }}>
      <MenuBar />
      <Rail />
      <div className="sh-body" style={{ gridTemplateColumns: bodyCols }}>
        <main className={`stage sh-stage ws-${workspace}`} style={is3d || Studio ? undefined : { display: 'none' }}>
          <Viewport />
          {workspace === 'prepare' && <><Toolbar /><ObjectPill /><TransformPanel /><PaintPanel /><AdvPaintPanel /><VlhPanel /><CutPanel /><BooleanPanel /><EdgesPanel /><TextPanel /><MeasurePanel /><BrimEarsPanel /><PlateList /><ObjectInfo /><LiveChip /></>}
          {workspace === 'preview' && <><PlateList /><Legend /><LayerSlider /><MoveSlider /><PreviewEmpty /></>}
          <ViewBar />
          <ViewCube />
          <CameraBar />
          <SliceProgress />
          {dragOver && <div className="dropzone">Drop to add to plate</div>}
        </main>
        {is3d && <RightDock />}
        {is3d && <RightColumn />}
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
      <ClickexStudioHost />
      <FlenexStudioHost />
      <MotionStudioHost />
      <InstantTooltips />
      <ShortcutsHost />
      <CommandPalette />
    </div>
  );
}

/** Keyboard shortcuts list (opened with ?). */
const SHORTCUTS: [string, [string, string][]][] = [
  ['Global', [['Ctrl+N', 'New project'], ['Ctrl+O', 'Open project'], ['Ctrl+S', 'Save project'], ['Ctrl+I', 'Import model'], ['Ctrl+R', 'Slice plate'],
    ['Ctrl+G', 'Export G-code'], ['Ctrl+P', 'Print plate'], ['Ctrl+F', 'Search settings'], ['Ctrl+K', 'Command palette'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+Tab', 'Next tab page (Shift: previous)'], ['Shift+?', 'Show this list']]],
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
