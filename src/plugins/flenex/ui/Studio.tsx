// Flenex Studio: a 98% window over NexSpiro. Left: design, cuts, paint and print tabs. Centre: live 3D view of
// the flexi on the selected printer's bed, where cuts are placed and colours painted. Right: report.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../../../state/store';
import { printerById } from '../../../profiles/printers';
import { triNormal, type PaintOp } from '../paint';
import { smartPlane, traceCentreline, ORIENTATIONS, type CutOrientation } from '../place';
import { pathLength } from '../groups';
import type { V3 } from '../csg';
import { defaultJoint } from '../joints';
import { cutFrame, newCut, probeCut, type Cut } from '../flexi';
import { EditorColumn, PrinterPicker } from './Editor';
import {
  addCut, addPart, addPaint, baseBvh, built, building, statusText, currentMachine, editAnyCut, export3mf, fx, lastError, meshVersion, nextCutId, notify, openStudio, paintVersion, sendToPlate, setTraceStart, traceStart, useFx,
} from './state';

export function FlenexStudioHost() {
  useFx();
  const installed = useStore((s) => s.plugins.includes('flenex'));
  if (!installed || !fx.studioOpen || typeof document === 'undefined') return null;
  return createPortal(<Studio />, document.body);
}

const PIECE_HUES = (i: number) => new THREE.Color().setHSL(((i * 0.618) % 1), 0.55, 0.58);

function Viewer() {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ rebuild: () => void; recolour: () => void; overlay: () => void; dispose: () => void } | null>(null);
  const [status, setStatus] = useState('');
  useFx();
  const printerId = useStore((s) => s.printerId);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(400, -600, 900); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-600, 500, 300); scene.add(fill);
    const model = new THREE.Group(), overlay = new THREE.Group(), bedGroup = new THREE.Group();
    scene.add(bedGroup, model, overlay);
    let mesh: THREE.Mesh | null = null, cent: Float32Array | null = null, framed = '', raf = 0;
    const cursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    cursor.visible = false; scene.add(cursor);

    const dark = () => document.documentElement.getAttribute('data-theme') === 'dark' || useStore.getState().theme === 'dark';
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();

    /** Per-vertex colours for the current view (colour = paint, pieces = one hue per piece, plain = grey). */
    const colours = (): Float32Array => {
      const b = built!, m = b.flexi.mesh, T = m.indices.length / 3, out = new Float32Array(T * 9);
      const pal = fx.palette.map((c) => new THREE.Color(c));
      for (let t = 0; t < T; t++) {
        const c = fx.view === 'pieces' ? PIECE_HUES(b.flexi.triPiece[t]) : fx.view === 'plain' ? new THREE.Color('#b9c0cc') : pal[(b.paint[t] || 1) - 1] ?? new THREE.Color('#888');
        for (let k = 0; k < 3; k++) { out[t * 9 + k * 3] = c.r; out[t * 9 + k * 3 + 1] = c.g; out[t * 9 + k * 3 + 2] = c.b; }
      }
      return out;
    };

    const rebuild = () => {
      const b = built; if (!b) return;
      if (mesh) { model.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      const m = b.flexi.mesh;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3)); g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      const flat = g.toNonIndexed(); g.dispose();
      flat.computeVertexNormals();
      flat.setAttribute('color', new THREE.BufferAttribute(colours(), 3));
      mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02 }));
      model.add(mesh);
      cent = new Float32Array((m.indices.length / 3) * 3);
      for (let t = 0; t < m.indices.length / 3; t++) for (let k = 0; k < 3; k++) cent[t * 3 + k] = (m.vertices[m.indices[t * 3] * 3 + k] + m.vertices[m.indices[t * 3 + 1] * 3 + k] + m.vertices[m.indices[t * 3 + 2] * 3 + k]) / 3;
      // bed under the model
      for (const c of [...bedGroup.children]) { bedGroup.remove(c); c.traverse((o) => { const x = o as THREE.Mesh; x.geometry?.dispose(); (x.material as THREE.Material | undefined)?.dispose?.(); }); }
      flat.computeBoundingBox();
      const bb = flat.boundingBox!, ctr = bb.getCenter(new THREE.Vector3()), mac = currentMachine();
      scene.background = new THREE.Color(dark() ? '#161b22' : '#dfe4ea');
      if (fx.showBed) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(mac.bed.x, mac.bed.y), new THREE.MeshStandardMaterial({ color: dark() ? '#2b3440' : '#c4cad3', roughness: 0.95 }));
        plane.position.set(ctr.x, ctr.y, -0.2);
        const over = !b.fit.fits;
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(mac.bed.x, mac.bed.y)), new THREE.LineBasicMaterial({ color: over ? 0xe5484d : 0x46c28f }));
        edge.position.set(ctr.x, ctr.y, 0.05);
        const grid = new THREE.GridHelper(Math.max(mac.bed.x, mac.bed.y), Math.round(Math.max(mac.bed.x, mac.bed.y) / 10), dark() ? 0x55606e : 0x9aa3af, dark() ? 0x3a4350 : 0xb5bcc6);
        grid.rotation.x = Math.PI / 2; grid.position.set(ctr.x, ctr.y, 0);
        bedGroup.add(plane, edge, grid);
      }
      const sig = `${Math.round(bb.max.x - bb.min.x)}|${Math.round(bb.max.y - bb.min.y)}|${printerId}|${fx.source}`;
      if (sig !== framed) {
        framed = sig;
        const size = bb.getSize(new THREE.Vector3()).length();
        controls.target.copy(ctr);
        camera.position.copy(ctr).add(new THREE.Vector3(0.35, -0.8, 0.9).normalize().multiplyScalar((size / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.15));
      }
      drawOverlay();
      setStatus(`${m.indices.length / 3} triangles · ${b.flexi.pieceCount} pieces · ${b.ms.toFixed(0)} ms`);
    };

    const recolour = () => {
      if (!mesh || !built) return;
      (mesh.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(colours(), 3));
    };

    const drawOverlay = () => {
      for (const c of [...overlay.children]) { overlay.remove(c); c.traverse((o) => { const x = o as THREE.Mesh; x.geometry?.dispose(); (x.material as THREE.Material | undefined)?.dispose?.(); }); }
      if (fx.showCuts) for (const g of fx.groups) {
        if (g.path.length < 2) continue;
        const sel = fx.selectedGroup === g.id;
        overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(g.path.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: sel ? 0xff5c8d : 0xb48cff })));
      }
      if (traceStart) { const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffd34d })); m.position.set(...traceStart.p); overlay.add(m); }
      if (!fx.showCuts || !built) return;
      const reports = new Map(built.flexi.reports.map((r) => [r.id, r]));
      for (const c of built.cuts) {
        const r = reports.get(c.id), centre = r?.centre ?? c.origin, rad = Math.max(3, Math.min(60, (r?.radius ?? c.radius) || 10));
        const M = cutFrame(centre, c.normal, c.roll);
        const sel = fx.selectedCut === c.id, bad = r && !r.ok;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), new THREE.MeshBasicMaterial({ color: bad ? 0xe5484d : sel ? 0xff5c8d : 0x35c2e8, transparent: true, opacity: sel ? 0.4 : 0.16, side: THREE.DoubleSide, depthWrite: false }));
        disc.applyMatrix4(M);
        const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * 6.2832) * rad, Math.sin((i / 48) * 6.2832) * rad, 0))), new THREE.LineBasicMaterial({ color: bad ? 0xe5484d : sel ? 0xff5c8d : 0x35c2e8 }));
        ring.applyMatrix4(M);
        overlay.add(disc, ring);
      }
    };

    // ---------------------------------------------------------------- pointer tools
    const ray = new THREE.Raycaster();
    const pick = (e: PointerEvent | MouseEvent) => {
      if (!mesh) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const h = ray.intersectObject(mesh, false)[0];
      return h && h.faceIndex !== undefined ? h : null;
    };
    // the plane that follows the cursor: square to the body, whatever its curve
    const ghost = new THREE.Group();
    const ghostDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
    const ghostRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * 6.2832), Math.sin((i / 64) * 6.2832), 0))), new THREE.LineBasicMaterial({ color: 0xffd34d }));
    const ghostAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1)]), new THREE.LineBasicMaterial({ color: 0xffffff }));
    ghost.add(ghostDisc, ghostRing, ghostAxis); ghost.visible = false; scene.add(ghost);
    let plane: { origin: V3; normal: V3 } | null = null;
    const showGhost = (origin: V3, normal: V3) => {
      const bvh = baseBvh(); if (!bvh) return;
      const pr = probeCut(bvh, origin, normal, 0).probe;
      const rad = Math.max(4, Math.min(60, (pr.outr || 8) * 1.2));
      const M = cutFrame(origin, normal, 0);
      ghost.matrix.copy(M).scale(new THREE.Vector3(rad, rad, rad * 0.9)); ghost.matrixAutoUpdate = false; ghost.matrixWorldNeedsUpdate = true;
      ghost.visible = true; plane = { origin, normal };
    };
    const planeAt = (h: THREE.Intersection, keep?: V3) => {
      const bvh = baseBvh(); if (!bvh || !built) return null;
      const n = h.face!.normal;
      return smartPlane(built.base, bvh, [h.point.x, h.point.y, h.point.z], [n.x, n.y, n.z], fx.orientation, keep);
    };
    let down: [number, number] | null = null, stroke: [number, number, number][] | null = null, painting = false;
    let dragging: { cut?: Cut; place?: boolean } | null = null, lastNormal: V3 | undefined, raf2 = 0;
    const paintLive = (p: THREE.Vector3) => {
      if (!built || !cent || !mesh) return;
      const col = (mesh.geometry as THREE.BufferGeometry).getAttribute('color') as THREE.BufferAttribute, c = new THREE.Color(fx.palette[fx.slot - 1]), r2 = fx.brush * fx.brush;
      let any = false;
      for (let t = 0; t < cent.length / 3; t++) if ((cent[t * 3] - p.x) ** 2 + (cent[t * 3 + 1] - p.y) ** 2 + (cent[t * 3 + 2] - p.z) ** 2 <= r2) { for (let k = 0; k < 3; k++) col.setXYZ(t * 3 + k, c.r, c.g, c.b); any = true; }
      if (any) col.needsUpdate = true;
    };
    const setControls = () => {
      const free = fx.tool === 'orbit';
      controls.mouseButtons = { LEFT: free ? THREE.MOUSE.ROTATE : (null as never), MIDDLE: THREE.MOUSE.DOLLY, RIGHT: free ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
      renderer.domElement.style.cursor = fx.tool === 'orbit' ? 'grab' : 'crosshair';
      if (fx.tool === 'orbit' || fx.tool === 'brush' || fx.tool === 'bucket' || fx.tool === 'piece') ghost.visible = false;
    };
    setControls();
    const cutTools = () => fx.tool === 'place' || fx.tool === 'move' || fx.tool === 'trace';
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
      if (e.button !== 0) return;
      if (fx.tool === 'brush') { const h = pick(e); if (h) { painting = true; stroke = [[h.point.x, h.point.y, h.point.z]]; paintLive(h.point); } return; }
      if (fx.tool === 'place' || fx.tool === 'move') {
        const h = pick(e); if (!h) return;
        const all = built?.cuts ?? [];
        const sel = all.find((c) => c.id === fx.selectedCut);
        if (fx.tool === 'move' && !sel) return;
        dragging = fx.tool === 'move' ? { cut: sel } : { place: true };
        lastNormal = sel && fx.tool === 'move' ? sel.normal : undefined;
        const pl = planeAt(h, lastNormal); if (pl) { showGhost(pl.origin, pl.normal); lastNormal = pl.normal; }
        (renderer.domElement as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
      const brush = fx.tool === 'brush';
      if (brush) {
        const h = pick(e);
        cursor.visible = !!h; if (h) { cursor.position.copy(h.point); cursor.scale.setScalar(fx.brush); (cursor.material as THREE.MeshBasicMaterial).color.set(fx.palette[fx.slot - 1] ?? '#fff'); }
        if (painting && h) { stroke!.push([h.point.x, h.point.y, h.point.z]); paintLive(h.point); }
        return;
      }
      cursor.visible = false;
      if (!cutTools()) return;
      cancelAnimationFrame(raf2);
      raf2 = requestAnimationFrame(() => {
        const h = pick(e);
        if (!h) { if (!dragging) ghost.visible = false; return; }
        if (fx.tool === 'trace') { ghost.visible = false; return; }
        const pl = planeAt(h, lastNormal); if (pl) { showGhost(pl.origin, pl.normal); if (dragging) lastNormal = pl.normal; }
      });
    });
    const finish = (e: PointerEvent) => {
      if (painting && stroke) { addPaint({ kind: 'stroke', pts: stroke, r: fx.brush, slot: fx.slot }); stroke = null; painting = false; down = null; return; }
      if (dragging) {
        const d = dragging; dragging = null; down = null;
        if (plane) {
          const pl = plane;
          if (d.place) { const c = newCut(nextCutId(), pl.origin, pl.normal, { ...fx.design.segments.joint, ...defaultJoint(fx.placeKind), kind: fx.placeKind }); c.name = `Cut ${c.id}`; addCut(c); }
          else if (d.cut) editAnyCut(d.cut, (x) => { x.origin = pl.origin; x.normal = pl.normal; });
        }
        lastNormal = undefined; ghost.visible = false;
        // one cut per press: back to orbit so the next click does not add another by accident
        fx.tool = 'orbit'; notify();
        return;
      }
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || e.button !== 0) { down = null; return; }
      down = null;
      const h = pick(e);
      if (!h || !built) return;
      const p: [number, number, number] = [h.point.x, h.point.y, h.point.z];
      if (fx.tool === 'trace') {
        const n = h.face!.normal, bvh = baseBvh();
        if (!traceStart) { setTraceStart({ p, sn: [n.x, n.y, n.z] }); return; }
        if (bvh) {
          const path = traceCentreline(bvh, built.base, traceStart.p, p, traceStart.sn);
          setTraceStart(null);
          if (path.length >= 3) { const len = pathLength(path); addPart(path, undefined, Math.max(2, Math.round(len / 14))); fx.tool = 'orbit'; notify(); }
        }
      } else if (fx.tool === 'bucket') addPaint({ kind: 'bucket', at: p, angle: fx.bucketAngle, slot: fx.slot });
      else if (fx.tool === 'piece') addPaint({ kind: 'piece', at: p, slot: fx.slot } as PaintOp);
      else if (fx.tool === 'orbit' && fx.showCuts) {
        // clicking near a cut disc selects it
        let best: string | null = null, bd = 12;
        for (const c of built.cuts) { const r = built.flexi.reports.find((x) => x.id === c.id); const o = r?.centre ?? c.origin; const d = Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]); if (d < bd + (r?.radius ?? 8) * 0.4 && d < bd * 4) { best = c.id; bd = d; } }
        if (best) { fx.selectedCut = best; fx.tab = 'cuts'; notify(); }
      }
    };
    renderer.domElement.addEventListener('pointerup', finish);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    api.current = { rebuild, recolour, overlay: drawOverlay, dispose: () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); } };
    (api.current as { setControls?: () => void }).setControls = setControls;
    return () => api.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { api.current?.rebuild(); }, [meshVersion, printerId, fx.showBed]);
  useEffect(() => { api.current?.recolour(); }, [paintVersion, fx.view, fx.palette.join(',')]);
  useEffect(() => { api.current?.overlay(); }, [fx.selectedCut, fx.showCuts, meshVersion, fx.selectedGroup, fx.groups, traceStart]);
  useEffect(() => { (api.current as { setControls?: () => void } | null)?.setControls?.(); }, [fx.tool]);

  return (
    <div className="lx-viewer">
      <div ref={host} className="lx-canvas" />
      <div className="lx-viewbar">
        {(['colour', 'pieces', 'plain'] as const).map((v) => <button key={v} className={`btn-small ${fx.view === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { fx.view = v; notify(); }}>{v === 'colour' ? 'Colours' : v === 'pieces' ? 'Pieces' : 'Plain'}</button>)}
        <span style={{ width: 10 }} />
        <button className={`btn-small ${fx.showCuts ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { fx.showCuts = !fx.showCuts; notify(); }}>Cuts</button>
        <button className={`btn-small ${fx.showBed ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { fx.showBed = !fx.showBed; notify(); }}>Bed</button>
        {fx.tool !== 'orbit' && <button className="btn-small btn-secondary" onClick={() => { fx.tool = 'orbit'; notify(); }}>Stop tool ({fx.tool})</button>}
      </div>
      {fx.tool !== 'orbit' && (
        <div className="fx-hint">
          {fx.tool === 'place' ? 'Press, slide, release' : fx.tool === 'move' ? 'Drag the selected cut along the body' : fx.tool === 'trace' ? (traceStart ? 'Now click the other end of the part' : 'Click one end of the part') : fx.tool === 'brush' ? 'Drag to paint' : fx.tool === 'bucket' ? 'Click to fill a surface area' : 'Click a segment to colour it'}
          {(fx.tool === 'place' || fx.tool === 'move') && (
            <span className="fx-dirbar"> · <select className="select" value={fx.orientation} onChange={(e) => { fx.orientation = e.target.value as CutOrientation; notify(); }}>{ORIENTATIONS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></span>
          )}
          <span> · right-drag orbits</span>
        </div>
      )}
      {building && <div className="fx-busy">{statusText || 'Building…'}</div>}
      <div className="lx-status">{lastError && !built ? lastError : status}</div>
    </div>
  );
}

function Report() {
  useFx();
  const b = built, mac = currentMachine();
  if (!b) return <div className="mx-sub">{lastError || 'Building the first model…'}</div>;
  const ok = b.flexi.reports.filter((r) => r.ok).length, bad = b.flexi.reports.filter((r) => !r.ok).length;
  const colours = new Map<number, number>();
  for (const s of b.paint) colours.set(s, (colours.get(s) ?? 0) + 1);
  const total = b.paint.length;
  return (
    <>
      <div className="mx-card">
        <div className="mx-card-title">Summary</div>
        <div className="fx-stat"><span>Pieces</span><b>{b.flexi.pieceCount}</b></div>
        <div className="fx-stat"><span>Joints working</span><b>{ok}{bad ? ` · ${bad} failed` : ''}</b></div>
        <div className="fx-stat"><span>Size</span><b>{b.fit.size.map((x) => x.toFixed(0)).join(' × ')} mm</b></div>
        <div className="fx-stat"><span>Bed {mac.bed.x}×{mac.bed.y}</span><b className={b.fit.fits ? 'ok' : 'bad'}>{b.fit.fits ? 'fits' : 'too big'}</b></div>
        <div className="fx-stat"><span>Solid</span><b className={b.flexi.closed ? 'ok' : 'bad'}>{b.flexi.closed ? 'watertight' : 'open edges'}</b></div>
        <div className="fx-stat"><span>Clearance</span><b>{mac.fit.clearance.toFixed(2)} mm</b></div>
      </div>
      <div className="mx-card">
        <div className="mx-card-title">Colours</div>
        {[...colours].sort((x, y) => x[0] - y[0]).map(([s, n]) => (
          <div key={s} className="fx-stat"><span><i className="fx-dot" style={{ background: fx.palette[s - 1] }} />Colour {s}</span><b>{Math.round((n / total) * 100)}%</b></div>
        ))}
        <div className="mx-sub">{colours.size > 1 ? (mac.multiColour === 'ams' ? 'Printed with the AMS.' : `${mac.printer.model} has no AMS: it pauses for a manual filament swap at every colour change.`) : 'Single colour.'}</div>
      </div>
      <div className="mx-card">
        <div className="mx-card-title">Check ({b.warnings.length})</div>
        {!b.warnings.length && <div className="mx-sub">No problems found.</div>}
        {b.warnings.slice(0, 40).map((w, i) => <div key={i} className="fx-warn">{w}</div>)}
      </div>
    </>
  );
}

function Studio() {
  useFx();
  const printer = printerById(useStore((s) => s.printerId));
  const [toast, setToast] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (fx.tool !== 'orbit') { fx.tool = 'orbit'; notify(); } else openStudio(false); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3200); };
  return (
    <div className="lx-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) openStudio(false); }}>
      <div className="lx-studio" role="dialog" aria-label="Flenex Studio">
        <header className="lx-top">
          <span className="mx-badge">F</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-title">Flenex Studio · {fx.source === 'import' ? fx.importName : fx.design.name}</div>
            <div className="mx-sub">{printer.vendor} {printer.model} · nozzle {printer.nozzle} mm · bed {printer.bed.x} × {printer.bed.y} × {printer.bed.z} mm</div>
          </div>
          <div style={{ width: 230 }}><PrinterPicker /></div>
          <button className="btn-secondary" disabled={!built} onClick={async () => { const p = await export3mf(); say(p ? `Saved ${p}` : 'Export cancelled'); }}>Export 3MF</button>
          <button className="btn-primary" disabled={!built} onClick={() => { const r = sendToPlate(); if (r) say(`Placed on the plate (${r.colours} colour${r.colours === 1 ? '' : 's'}).`); }}>Send to plate</button>
          <button className="btn-secondary" onClick={() => openStudio(false)} aria-label="Close">✕</button>
        </header>
        <div className="lx-body">
          <aside className="lx-col lx-left"><div className="mx-panel"><EditorColumn onToast={say} /></div></aside>
          <main className="lx-centre"><Viewer /></main>
          <aside className="lx-col lx-right"><div className="mx-panel"><Report /></div></aside>
        </div>
        {toast && <div className="lx-toast">{toast}</div>}
      </div>
    </div>
  );
}
void triNormal;
