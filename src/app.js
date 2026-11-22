// Editor controller: state, tools, pointer/touch gestures, panels, import/export.
import {
  createDocument, createElement, addElements, removeElements, updateElements, duplicateElements,
  reorder, reorderToEnd, elementMatrix, frameMatrix, geometry, worldBox, unionBox, newId, clamp,
  normalizeColor, PALETTE, MIN_STRIP, MAX_STRIP, MIN_CANVAS, MAX_CANVAS,
} from './model.js';
import {
  apply, invert, rotate as rotMatrix, rectsIntersect, distToPolylines, pointInPolylines,
  simplifyPoints, smoothPoints, pointsToPath, fmt,
} from './geometry.js';
import { History } from './history.js';
import { TEMPLATES, templatePath } from './templates.js';
import { exportSvg, importSvg, ImportError } from './svg.js';
import { Renderer, selectionFrame, previewSvg } from './renderer.js';
import { AutoSave } from './storage.js';
import { installIcons } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const EXPORT_NAME = 'quilling-design.svg';
const coarse = () => matchMedia('(pointer: coarse)').matches;
const isMobileLayout = () => matchMedia('(max-width: 899px)').matches;

class Editor {
  constructor() {
    this.stage = $('#stage');
    this.svg = $('#canvas');
    this.renderer = new Renderer(this.svg);
    this.history = new History(100);
    this.autosave = new AutoSave();
    this.doc = this.autosave.load() || createDocument();
    this.selection = [];
    this.tool = 'draw';
    this.style = { color: PALETTE[0], width: 4, paper: true };
    this.view = { x: 0, y: 0, zoom: 1 };
    this.pointers = new Map();
    this.gesture = null;
    this.txStart = null; // document before the running interaction
    this.spaceDown = false;
    this.lastPen = 0;
    this.clipboard = [];
    this.frame = 0;
    this.overlayInfo = null;
    this.hover = null;

    installIcons();
    this.buildLibrary();
    this.buildProperties();
    this.bindToolbar();
    this.bindCanvas();
    this.bindKeyboard();
    this.bindFiles();
    this.bindViewportResize();
    this.setTool('draw');
    this.syncUi();

    new ResizeObserver(() => this.requestRender()).observe(this.stage);
    requestAnimationFrame(() => {
      this.fitView();
      this.render();
    });
    window.addEventListener('pagehide', () => this.autosave.flush());
    document.addEventListener('visibilitychange', () => document.hidden && this.autosave.flush());
  }

  // ------------------------------------------------------------------ state

  /** Applies a finished change as one undo step. */
  commit(doc, selection = this.selection) {
    if (doc === this.doc) return;
    this.history.record(this.doc);
    this.doc = doc;
    this.selection = selection.filter((id) => doc.elements.some((e) => e.id === id));
    this.changed();
  }

  begin() {
    this.txStart = this.doc;
  }

  /** Live update during an interaction (no undo step yet). */
  live(doc) {
    this.doc = doc;
    this.requestRender();
  }

  end() {
    if (this.txStart && this.txStart !== this.doc) {
      this.history.record(this.txStart);
      this.changed();
    }
    this.txStart = null;
  }

  cancel() {
    if (this.txStart) this.doc = this.txStart;
    this.txStart = null;
    this.requestRender();
  }

  changed() {
    this.autosave.schedule(this.doc);
    this.requestRender();
    this.syncUi();
  }

  undo() {
    if (this.gesture) return;
    const prev = this.history.undo(this.doc);
    if (prev) this.restore(prev);
  }

  redo() {
    if (this.gesture) return;
    const next = this.history.redo(this.doc);
    if (next) this.restore(next);
  }

  restore(doc) {
    this.doc = doc;
    this.selection = this.selection.filter((id) => doc.elements.some((e) => e.id === id));
    this.changed();
  }

  selectedElements() {
    const set = new Set(this.selection);
    return this.doc.elements.filter((e) => set.has(e.id));
  }

  setSelection(ids) {
    this.selection = ids;
    this.requestRender();
    this.syncUi();
  }

  // ------------------------------------------------------------------ view

  toCanvas([sx, sy]) {
    return [(sx - this.view.x) / this.view.zoom, (sy - this.view.y) / this.view.zoom];
  }

  toScreen([x, y]) {
    return [x * this.view.zoom + this.view.x, y * this.view.zoom + this.view.y];
  }

  stagePoint(e) {
    const r = this.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  fitView() {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const margin = Math.min(40, r.width * 0.06);
    const zoom = clamp(Math.min((r.width - margin * 2) / this.doc.width, (r.height - margin * 2) / this.doc.height), MIN_ZOOM, MAX_ZOOM);
    this.view = { zoom, x: (r.width - this.doc.width * zoom) / 2, y: (r.height - this.doc.height * zoom) / 2 };
    this.requestRender();
  }

  zoomAt(factor, [sx, sy]) {
    const zoom = clamp(this.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / this.view.zoom;
    this.view = { zoom, x: sx - (sx - this.view.x) * k, y: sy - (sy - this.view.y) * k };
    this.requestRender();
  }

  zoomCenter(factor) {
    const r = this.svg.getBoundingClientRect();
    this.zoomAt(factor, [r.width / 2, r.height / 2]);
  }

  visibleCenter() {
    const r = this.svg.getBoundingClientRect();
    return this.toCanvas([r.width / 2, r.height / 2]);
  }

  // ------------------------------------------------------------------ rendering

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    this.renderer.setView(this.view);
    this.renderer.renderDocument(this.doc);
    this.overlayInfo = this.renderer.renderOverlay({
      elements: this.selectedElements(),
      toScreen: (p) => this.toScreen(p),
      handleSize: coarse() ? 22 : 11,
      band: this.gesture?.type === 'band' ? this.gesture.rect : null,
      hover: this.tool === 'eraser' && this.hover ? this.doc.elements.find((e) => e.id === this.hover) : null,
    });
    const z = $('.zoom-label');
    if (z) z.textContent = `${Math.round(this.view.zoom * 100)}%`;
  }

  // ------------------------------------------------------------------ hit testing

  hitElement(p, { strict = false, tolerance = 6 } = {}) {
    const tol = tolerance / this.view.zoom;
    for (let i = this.doc.elements.length - 1; i >= 0; i--) {
      const el = this.doc.elements[i];
      const box = worldBox(el);
      if (p[0] < box.x - tol || p[0] > box.x + box.width + tol || p[1] < box.y - tol || p[1] > box.y + box.height + tol) continue;
      const m = elementMatrix(el);
      const local = apply(invert(m), p);
      const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      const g = geometry(el);
      const dist = distToPolylines(local, g.lines) * s;
      const half = (el.width * Math.sqrt(Math.abs(el.sx * el.sy))) / 2;
      if (dist <= half + tol) return el;
      if (el.fill !== 'none' && pointInPolylines(local, g.lines)) return el;
      if (!strict && el.kind === 'template' && el.template !== 's-scroll' && el.template !== 'c-scroll' && el.template !== 'v-scroll') {
        const fm = invert(frameMatrix(el));
        const q = apply(fm, p);
        const b = g.box;
        if (q[0] >= b.x && q[0] <= b.x + b.width && q[1] >= b.y && q[1] <= b.y + b.height) return el;
      }
    }
    return null;
  }

  hitHandle(sp) {
    const info = this.overlayInfo;
    if (!info) return null;
    const r = coarse() ? 26 : 12;
    if (Math.hypot(sp[0] - info.rotate[0], sp[1] - info.rotate[1]) <= r) return { type: 'rotate' };
    for (let i = 0; i < 4; i++) {
      const c = info.corners[i];
      if (Math.hypot(sp[0] - c[0], sp[1] - c[1]) <= r) return { type: 'scale', corner: i };
    }
    return null;
  }

  // ------------------------------------------------------------------ tools

  setTool(tool) {
    this.tool = tool;
    this.stage.dataset.tool = tool;
    for (const b of $$('[data-tool]')) {
      b.classList.toggle('active', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
    if (tool !== 'select' && this.selection.length) this.setSelection([]);
    this.hover = null;
    this.requestRender();
  }

  bindCanvas() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
    svg.addEventListener('pointerup', (e) => this.onPointerUp(e));
    svg.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    svg.addEventListener('lostpointercapture', (e) => this.pointers.has(e.pointerId) && this.onPointerUp(e, true));
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = clamp(e.deltaY * unit, -200, 200);
      this.zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)), this.stagePoint(e));
    }, { passive: false });
    // Safari-specific pinch events would zoom the whole page.
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) svg.addEventListener(t, (e) => e.preventDefault());
    svg.addEventListener('dblclick', (e) => e.preventDefault());
  }

  onPointerDown(e) {
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    this.closeSheets();
    e.preventDefault();
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const sp = this.stagePoint(e);
    // Palm rejection: a hand resting on the screen while the pen draws is ignored completely.
    if (e.pointerType === 'touch' && this.isPenDown()) return;
    this.pointers.set(e.pointerId, { sp, type: e.pointerType });

    // Palm rejection: while a pen is in use, touches never draw/edit.
    const penActive = e.pointerType === 'touch' && (this.isPenDown() || performance.now() - this.lastPen < 1500);

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length === 2) {
      this.startTwoFinger();
      return;
    }
    if (this.gesture) return; // another pointer is already busy

    if (e.button === 1 || this.spaceDown || penActive || (e.pointerType === 'touch' && touches.length > 2)) {
      this.gesture = { type: 'pan', pointerId: e.pointerId, last: sp };
      this.stage.dataset.panning = 'active';
      return;
    }
    const p = this.toCanvas(sp);
    if (this.tool === 'draw') this.startStroke(e, p);
    else if (this.tool === 'eraser') {
      this.begin();
      this.gesture = { type: 'erase', pointerId: e.pointerId, last: p };
      this.eraseAt(p, p);
    } else this.startSelect(e, sp, p);
  }

  isPenDown() {
    return [...this.pointers.values()].some((p) => p.type === 'pen');
  }

  onPointerMove(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (!ptr) {
      if (this.tool === 'eraser' && e.pointerType === 'mouse') {
        const id = this.hitElement(this.toCanvas(this.stagePoint(e)), { strict: true })?.id ?? null;
        if (id !== this.hover) {
          this.hover = id;
          this.requestRender();
        }
      }
      return;
    }
    ptr.sp = this.stagePoint(e);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch' || g.type === 'touch-transform') {
      this.updateTwoFinger();
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    const sp = ptr.sp;
    const p = this.toCanvas(sp);
    switch (g.type) {
      case 'pan':
        this.view = { ...this.view, x: this.view.x + sp[0] - g.last[0], y: this.view.y + sp[1] - g.last[1] };
        g.last = sp;
        this.requestRender();
        break;
      case 'stroke': {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        const r = this.svg.getBoundingClientRect();
        for (const ev of events.length ? events : [e]) {
          const q = this.toCanvas([ev.clientX - r.left, ev.clientY - r.top]);
          const last = g.points[g.points.length - 1];
          if (Math.hypot(q[0] - last[0], q[1] - last[1]) * this.view.zoom < 0.75) continue;
          g.points.push(q);
          g.d += `L${fmt(q[0])} ${fmt(q[1])}`;
        }
        this.scheduleLive();
        break;
      }
      case 'erase':
        this.eraseAt(g.last, p);
        g.last = p;
        break;
      case 'move': {
        const dx = p[0] - g.start[0];
        const dy = p[1] - g.start[1];
        if (!g.moved && Math.hypot(dx, dy) * this.view.zoom < 3) return;
        g.moved = true;
        this.live(updateElements(this.txStart, this.selection, (el) => ({ x: el.x + dx, y: el.y + dy })));
        break;
      }
      case 'scale':
        this.updateScale(g, p, e.shiftKey);
        break;
      case 'rotate':
        this.updateRotate(g, p, e.shiftKey);
        break;
      case 'band': {
        g.rect = {
          x: Math.min(g.start[0], p[0]), y: Math.min(g.start[1], p[1]),
          width: Math.abs(p[0] - g.start[0]), height: Math.abs(p[1] - g.start[1]),
        };
        const hits = this.doc.elements.filter((el) => rectsIntersect(worldBox(el), g.rect)).map((el) => el.id);
        this.selection = g.additive ? [...new Set([...g.initial, ...hits])] : hits;
        this.requestRender();
        break;
      }
    }
  }

  onPointerUp(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch' || g.type === 'touch-transform') {
      if (this.pointers.size < 2) {
        if (g.type === 'touch-transform') this.end();
        // Remaining finger must not start drawing: swallow until it is lifted.
        this.gesture = this.pointers.size ? { type: 'idle', pointerId: [...this.pointers.keys()][0] } : null;
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    this.gesture = null;
    switch (g.type) {
      case 'pan':
        this.stage.dataset.panning = this.spaceDown ? 'true' : 'false';
        break;
      case 'stroke':
        this.renderer.setLiveStroke(null);
        if (!cancelled) this.finishStroke(g);
        break;
      case 'erase':
      case 'move':
      case 'scale':
      case 'rotate':
        if (cancelled && g.type !== 'erase') this.cancel();
        else this.end();
        break;
      case 'band':
        this.syncUi();
        break;
    }
    this.requestRender();
  }

  // ---- drawing

  startStroke(e, p) {
    this.gesture = { type: 'stroke', pointerId: e.pointerId, points: [p], d: `M${fmt(p[0])} ${fmt(p[1])}` };
    this.scheduleLive();
  }

  scheduleLive() {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      const g = this.gesture;
      if (g?.type === 'stroke') this.renderer.setLiveStroke(g.points.length === 1 ? `${g.d}l0 0` : g.d, this.style.color, this.style.width);
    });
  }

  finishStroke(g) {
    let pts = simplifyPoints(g.points, 1.5 / this.view.zoom);
    pts = smoothPoints(pts, 2);
    const d = pts.length === 1 ? `M${fmt(pts[0][0])} ${fmt(pts[0][1])}l0 0` : pointsToPath(pts);
    const el = createElement({ kind: 'stroke', d, ...this.style });
    this.commit(addElements(this.doc, [el]));
  }

  // ---- eraser

  eraseAt(from, to) {
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil((dist * this.view.zoom) / 4));
    const ids = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const hit = this.hitElement(p, { strict: true, tolerance: coarse() ? 12 : 8 });
      if (hit) ids.add(hit.id);
    }
    if (ids.size) this.live(removeElements(this.doc, [...ids]));
  }

  // ---- selecting and transforming

  startSelect(e, sp, p) {
    const handle = this.selection.length ? this.hitHandle(sp) : null;
    if (handle) {
      this.begin();
      const frame = selectionFrame(this.selectedElements());
      // Use the corners as drawn on screen (they may be enlarged around small shapes).
      frame.corners = this.overlayInfo.corners.map((c) => this.toCanvas(c));
      const center = [(frame.corners[0][0] + frame.corners[2][0]) / 2, (frame.corners[0][1] + frame.corners[2][1]) / 2];
      if (handle.type === 'rotate') {
        this.gesture = { type: 'rotate', pointerId: e.pointerId, center, startAngle: Math.atan2(p[1] - center[1], p[0] - center[0]), single: frame.single };
      } else {
        const anchor = frame.corners[(handle.corner + 2) % 4];
        this.gesture = { type: 'scale', pointerId: e.pointerId, corner: handle.corner, anchor, dragged: frame.corners[handle.corner], single: frame.single };
      }
      return;
    }
    const hit = this.hitElement(p);
    if (hit) {
      if (e.shiftKey) {
        const sel = this.selection.includes(hit.id) ? this.selection.filter((id) => id !== hit.id) : [...this.selection, hit.id];
        this.setSelection(sel);
        if (!sel.includes(hit.id)) return;
      } else if (!this.selection.includes(hit.id)) this.setSelection([hit.id]);
      this.begin();
      this.gesture = { type: 'move', pointerId: e.pointerId, start: p, moved: false };
      return;
    }
    if (!e.shiftKey && this.selection.length) this.setSelection([]);
    this.gesture = { type: 'band', pointerId: e.pointerId, start: p, rect: null, additive: e.shiftKey, initial: [...this.selection] };
  }

  updateScale(g, p, keepRatio) {
    const start = this.txStart;
    const ids = new Set(this.selection);
    if (g.single) {
      const el = start.elements.find((x) => ids.has(x.id));
      // Work in the element's rotated frame: vector anchor -> pointer vs. anchor -> dragged corner.
      const unrot = rotMatrix(-el.rotation);
      const v = apply(unrot, [p[0] - g.anchor[0], p[1] - g.anchor[1]]);
      const u = apply(unrot, [g.dragged[0] - g.anchor[0], g.dragged[1] - g.anchor[1]]);
      let kx = Math.abs(u[0]) > 1e-6 ? v[0] / u[0] : 1;
      let ky = Math.abs(u[1]) > 1e-6 ? v[1] / u[1] : 1;
      if (keepRatio) kx = ky = Math.max(0.01, (v[0] * u[0] + v[1] * u[1]) / (u[0] * u[0] + u[1] * u[1]));
      kx = Math.max(kx, 0.02);
      ky = Math.max(ky, 0.02);
      const sx = el.sx * kx;
      const sy = el.sy * ky;
      // Keep the anchor corner fixed in canvas space.
      const localAnchor = apply(invert(frameMatrix(el)), g.anchor);
      const moved = { ...el, sx, sy };
      const now = apply(frameMatrix(moved), localAnchor);
      this.live(updateElements(start, [el.id], () => ({ sx, sy, x: el.x + g.anchor[0] - now[0], y: el.y + g.anchor[1] - now[1] })));
      return;
    }
    const u = [g.dragged[0] - g.anchor[0], g.dragged[1] - g.anchor[1]];
    const v = [p[0] - g.anchor[0], p[1] - g.anchor[1]];
    const k = Math.max(0.02, (v[0] * u[0] + v[1] * u[1]) / (u[0] * u[0] + u[1] * u[1]));
    this.live(updateElements(start, this.selection, (el) => ({
      x: g.anchor[0] + (el.x - g.anchor[0]) * k,
      y: g.anchor[1] + (el.y - g.anchor[1]) * k,
      sx: el.sx * k,
      sy: el.sy * k,
    })));
  }

  updateRotate(g, p, snap) {
    let delta = ((Math.atan2(p[1] - g.center[1], p[0] - g.center[0]) - g.startAngle) * 180) / Math.PI;
    if (snap) delta = Math.round(delta / 15) * 15;
    this.live(this.rotateSelection(this.txStart, delta, g.center));
  }

  rotateSelection(doc, delta, center) {
    const m = rotMatrix(delta);
    return updateElements(doc, this.selection, (el) => {
      const [x, y] = apply(m, [el.x - center[0], el.y - center[1]]);
      return { x: center[0] + x, y: center[1] + y, rotation: normalizeAngle(el.rotation + delta) };
    });
  }

  // ---- two-finger gestures (touch)

  startTwoFinger() {
    const g = this.gesture;
    // Abort whatever the first finger started, without leaving a stray stroke.
    if (g?.type === 'stroke') this.renderer.setLiveStroke(null);
    else if (g && ['move', 'scale', 'rotate', 'erase'].includes(g.type)) this.cancel();
    else if (g?.type === 'band') this.selection = g.initial;
    const [a, b] = [...this.pointers.values()].filter((p) => p.type === 'touch').map((p) => p.sp);
    const start = { a, b, view: { ...this.view } };
    const mid = this.toCanvas([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const onSelection = this.selection.length && this.tool === 'select' &&
      [a, b, null].some((sp) => {
        const q = sp ? this.toCanvas(sp) : mid;
        const hit = this.hitElement(q, { tolerance: 16 });
        return hit && this.selection.includes(hit.id);
      });
    if (onSelection) {
      this.begin();
      this.gesture = { type: 'touch-transform', ...start };
    } else {
      this.gesture = { type: 'pinch', ...start };
    }
    this.requestRender();
  }

  updateTwoFinger() {
    const g = this.gesture;
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch').map((p) => p.sp);
    if (touches.length < 2) return;
    const [a, b] = touches;
    const d0 = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1;
    const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const k = d1 / d0;
    const m0 = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
    const m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (g.type === 'pinch') {
      const zoom = clamp(g.view.zoom * k, MIN_ZOOM, MAX_ZOOM);
      const c = [(m0[0] - g.view.x) / g.view.zoom, (m0[1] - g.view.y) / g.view.zoom];
      this.view = { zoom, x: m1[0] - c[0] * zoom, y: m1[1] - c[1] * zoom };
      this.requestRender();
      return;
    }
    const angle = ((Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0])) * 180) / Math.PI;
    const c0 = this.toCanvas(m0);
    const c1 = this.toCanvas(m1);
    const rm = rotMatrix(angle);
    this.live(updateElements(this.txStart, this.selection, (el) => {
      const [x, y] = apply(rm, [(el.x - c0[0]) * k, (el.y - c0[1]) * k]);
      return { x: c1[0] + x, y: c1[1] + y, sx: el.sx * k, sy: el.sy * k, rotation: normalizeAngle(el.rotation + angle) };
    }));
  }

  // ------------------------------------------------------------------ actions

  action(name, opts = {}) {
    const sel = this.selection;
    switch (name) {
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'delete':
        if (sel.length) this.commit(removeElements(this.doc, sel), []);
        return;
      case 'duplicate':
        if (sel.length) {
          const { doc, ids } = duplicateElements(this.doc, sel, 20 / Math.max(this.view.zoom, 0.5));
          this.commit(doc, ids);
        }
        return;
      case 'forward':
        if (sel.length) this.commit(opts.toEnd ? reorderToEnd(this.doc, sel, 1) : reorder(this.doc, sel, 1));
        return;
      case 'backward':
        if (sel.length) this.commit(opts.toEnd ? reorderToEnd(this.doc, sel, -1) : reorder(this.doc, sel, -1));
        return;
      case 'zoom-in':
        return this.zoomCenter(1.25);
      case 'zoom-out':
        return this.zoomCenter(0.8);
      case 'zoom-reset': {
        const c = this.visibleCenter();
        const r = this.svg.getBoundingClientRect();
        this.view = { zoom: 1, x: r.width / 2 - c[0], y: r.height / 2 - c[1] };
        return this.requestRender();
      }
      case 'fit':
        return this.fitView();
      case 'new':
        return this.clearCanvas();
      case 'import':
        $('#file-input').click();
        return;
      case 'export':
        return this.exportFile();
      case 'select-all':
        this.setTool('select');
        return this.setSelection(this.doc.elements.map((e) => e.id));
      case 'copy':
        this.clipboard = this.selectedElements();
        return;
      case 'paste':
        if (this.clipboard.length) {
          const copies = this.clipboard.map((el) => ({ ...el, id: newId(), x: el.x + 20, y: el.y + 20 }));
          this.clipboard = copies;
          this.setTool('select');
          this.commit(addElements(this.doc, copies), copies.map((c) => c.id));
        }
        return;
    }
  }

  async clearCanvas() {
    if (!this.doc.elements.length) return;
    const ok = await this.ask({
      title: 'Clear canvas?',
      message: 'All elements will be removed. You can undo this afterwards.',
      buttons: [{ label: 'Cancel', value: false }, { label: 'Clear canvas', value: true, kind: 'danger' }],
    });
    if (ok) this.commit({ ...this.doc, elements: [] }, []);
  }

  addTemplate(id, at) {
    const el = createElement({
      kind: 'template', template: id, d: templatePath(id), ...this.style, x: at[0], y: at[1],
    });
    this.setTool('select');
    this.commit(addElements(this.doc, [el]), [el.id]);
  }

  /** Applies a style change to the defaults and, if any, the selected elements. */
  applyStyle(patch, { liveOnly = false } = {}) {
    Object.assign(this.style, patch);
    if (this.selection.length) {
      if (!this.txStart) this.begin();
      const doc = updateElements(this.txStart, this.selection, (el) => {
        const out = { ...patch };
        if ('color' in patch && el.fill !== 'none' && el.kind === 'path') {
          if (el.width === 0) out.fill = patch.color; // filled shapes without outline: recolor the fill
        }
        if ('width' in patch && el.kind === 'path' && el.width === 0 && el.fill !== 'none') delete out.width;
        return out;
      });
      this.live(doc);
      if (!liveOnly) this.end();
    }
    this.syncUi();
  }

  // ------------------------------------------------------------------ files

  bindFiles() {
    const input = $('#file-input');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) this.importFile(file);
    });
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    this.stage.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.stage.classList.add('file-over');
    });
    this.stage.addEventListener('dragleave', (e) => {
      if (e.target === this.stage || !this.stage.contains(e.relatedTarget)) this.stage.classList.remove('file-over');
    });
    this.stage.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.stage.classList.remove('file-over');
      const file = e.dataTransfer.files[0];
      if (file) this.importFile(file);
    });
    // Dropping files elsewhere must not navigate away from the editor.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  async importFile(file) {
    let result;
    try {
      if (file.size > 20 * 1024 * 1024) throw new ImportError('The file is too large (maximum 20 MB).');
      const looksSvg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
      const text = await file.text();
      if (!looksSvg && !/<svg[\s>]/i.test(text.slice(0, 4096))) throw new ImportError('Please choose an .svg file.');
      result = importSvg(text);
    } catch (e) {
      const msg = e instanceof ImportError ? e.message : 'The file could not be read.';
      await this.ask({ title: 'Import failed', message: `${file.name}: ${msg}\nYour current design was not changed.`, buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
      return;
    }
    const { doc: imported, skipped } = result;
    if (!imported.elements.length && imported.background === '#ffffff') {
      await this.ask({ title: 'Nothing to import', message: `${file.name} contains no shapes the editor can display.\nYour current design was not changed.`, buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
      return;
    }
    let mode = 'replace';
    if (this.doc.elements.length) {
      mode = await this.ask({
        title: 'Import SVG',
        message: `Replace the current design with “${file.name}” or add its ${imported.elements.length} element(s) to it?`,
        buttons: [
          { label: 'Cancel', value: null },
          { label: 'Add to design', value: 'add' },
          { label: 'Replace design', value: 'replace', kind: 'primary' },
        ],
      });
      if (!mode) return;
    }
    if (mode === 'replace') {
      this.commit(imported, []);
      this.fitView();
    } else {
      const existing = new Set(this.doc.elements.map((e) => e.id));
      const els = imported.elements.map((el) => (existing.has(el.id) ? { ...el, id: newId() } : el));
      this.setTool('select');
      this.commit(addElements(this.doc, els), els.map((e) => e.id));
    }
    this.syncCanvasInputs();
    if (skipped) this.toast(`Imported. ${skipped} unsupported item(s) were skipped.`);
  }

  async exportFile() {
    const text = exportSvg(this.doc);
    const blob = new Blob([text], { type: 'image/svg+xml' });
    if (coarse() && navigator.canShare) {
      try {
        const file = new File([blob], EXPORT_NAME, { type: 'image/svg+xml' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Quilling design' });
          return;
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
        // fall through to a regular download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ------------------------------------------------------------------ UI wiring

  bindToolbar() {
    for (const b of $$('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    for (const b of $$('[data-action]')) {
      b.addEventListener('click', (e) => {
        if (b.closest('#more')) this.closeSheets();
        this.action(b.dataset.action, { toEnd: e.shiftKey });
      });
    }
    for (const b of $$('[data-toggle]')) b.addEventListener('click', () => this.toggleSheet(b.dataset.toggle));
    for (const b of $$('[data-close]')) b.addEventListener('click', () => this.closeSheets());
  }

  toggleSheet(id) {
    const sheet = document.getElementById(id);
    const open = !sheet.classList.contains('open');
    this.closeSheets();
    if (open) {
      sheet.classList.add('open');
      $$(`[data-toggle="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
    }
  }

  closeSheets() {
    for (const s of $$('.sheet.open')) s.classList.remove('open');
    for (const b of $$('[data-toggle]')) b.setAttribute('aria-expanded', 'false');
    if (document.activeElement?.closest?.('.sheet') && isMobileLayout()) document.activeElement.blur();
  }

  buildLibrary() {
    const grid = $('.template-grid');
    for (const t of TEMPLATES) {
      const btn = document.createElement('button');
      btn.className = 'template';
      btn.setAttribute('role', 'listitem');
      btn.title = `${t.name} – drag onto the canvas or click to add`;
      btn.dataset.template = t.id;
      btn.innerHTML = `${previewSvg(templatePath(t.id))}<span>${t.name}</span>`;
      grid.append(btn);
      this.bindTemplateDrag(btn, t.id);
    }
  }

  bindTemplateDrag(btn, id) {
    let drag = null;
    const cleanup = () => {
      drag?.ghost?.remove();
      this.renderer.setGhost(null);
      drag = null;
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, start: [e.clientX, e.clientY], active: false, ghost: null };
    });
    btn.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.active && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) > 6) {
        drag.active = true;
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'drag-ghost';
        drag.ghost.innerHTML = previewSvg(templatePath(id), this.style.color);
        document.body.append(drag.ghost);
        if (isMobileLayout()) this.closeSheets();
      }
      if (!drag.active) return;
      drag.ghost.style.transform = `translate(${e.clientX - 36}px, ${e.clientY - 36}px)`;
      const at = this.dropPoint(e);
      drag.ghost.classList.toggle('over-canvas', Boolean(at));
      this.renderer.setGhost(at ? createElement({ kind: 'template', template: id, d: templatePath(id), ...this.style, x: at[0], y: at[1] }) : null);
    });
    btn.addEventListener('pointerup', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.active) {
        const at = this.dropPoint(e);
        if (at) this.addTemplate(id, at);
      } else {
        // Tap / click: place in the center of the visible canvas area.
        if (isMobileLayout()) this.closeSheets();
        this.addTemplate(id, this.visibleCenter());
      }
      cleanup();
    });
    btn.addEventListener('pointercancel', cleanup);
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) this.addTemplate(id, this.visibleCenter()); // keyboard activation
    });
  }

  /** Canvas point under the pointer if it is over the artboard, else null. */
  dropPoint(e) {
    const r = this.svg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (top && !this.svg.contains(top) && top !== this.svg) return null; // over a panel or sheet
    const p = this.toCanvas([e.clientX - r.left, e.clientY - r.top]);
    if (p[0] < 0 || p[1] < 0 || p[0] > this.doc.width || p[1] > this.doc.height) return null;
    return p;
  }

  buildProperties() {
    const swatches = $('.swatches');
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.title = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Color ${c}`);
      b.addEventListener('click', () => this.applyStyle({ color: c }));
      swatches.append(b);
    }
    const picker = $('#color-picker');
    picker.addEventListener('input', () => this.applyStyle({ color: picker.value }, { liveOnly: true }));
    picker.addEventListener('change', () => this.applyStyle({ color: picker.value }));
    const hex = $('#color-hex');
    const applyHex = () => {
      const v = hex.value.trim();
      const c = normalizeColor(v.startsWith('#') ? v : `#${v}`, null);
      if (c) this.applyStyle({ color: c });
      else hex.value = this.style.color;
    };
    hex.addEventListener('change', applyHex);
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyHex();
        hex.blur();
      }
    });
    const width = $('#strip-width');
    width.addEventListener('input', () => this.applyStyle({ width: Number(width.value) }, { liveOnly: true }));
    width.addEventListener('change', () => this.applyStyle({ width: Number(width.value) }));
    const paper = $('#paper-look');
    paper.addEventListener('change', () => this.applyStyle({ paper: paper.checked }));

    const cw = $('#canvas-width');
    const ch = $('#canvas-height');
    const applySize = () => {
      const w = clamp(Math.round(Number(cw.value)) || this.doc.width, MIN_CANVAS, MAX_CANVAS);
      const h = clamp(Math.round(Number(ch.value)) || this.doc.height, MIN_CANVAS, MAX_CANVAS);
      if (w !== this.doc.width || h !== this.doc.height) {
        this.commit({ ...this.doc, width: w, height: h });
        this.fitView();
      }
      this.syncCanvasInputs();
    };
    cw.addEventListener('change', applySize);
    ch.addEventListener('change', applySize);
    const bg = $('#canvas-bg');
    bg.addEventListener('input', () => {
      if (!this.txStart) this.begin();
      this.live({ ...this.doc, background: bg.value });
    });
    bg.addEventListener('change', () => {
      if (!this.txStart) this.begin();
      this.live({ ...this.doc, background: bg.value });
      this.end();
    });
    this.syncCanvasInputs();
  }

  syncCanvasInputs() {
    $('#canvas-width').value = this.doc.width;
    $('#canvas-height').value = this.doc.height;
    $('#canvas-bg').value = this.doc.background;
  }

  /** Reflects state (selection, style, history) in the toolbar and panels. */
  syncUi() {
    const sel = this.selectedElements();
    if (sel.length === 1) {
      // Show the selected element's own style.
      this.style = { ...this.style, color: sel[0].color, width: sel[0].width || this.style.width, paper: sel[0].paper };
    }
    for (const b of $$('[data-needs-selection]')) b.disabled = !sel.length;
    $('[data-action="undo"]').disabled = !this.history.canUndo();
    $('[data-action="redo"]').disabled = !this.history.canRedo();
    $('.selection-bar').hidden = !sel.length;
    const note = $('.selection-note');
    note.hidden = !sel.length;
    note.textContent = sel.length ? `Changes apply to ${sel.length} selected element${sel.length > 1 ? 's' : ''}.` : '';
    for (const s of $$('.swatch')) s.setAttribute('aria-checked', String(s.dataset.color === this.style.color));
    if (document.activeElement !== $('#color-hex')) $('#color-hex').value = this.style.color;
    $('#color-picker').value = this.style.color;
    $('#strip-width').value = this.style.width;
    $('#strip-width-value').textContent = `${this.style.width} px`;
    $('#paper-look').checked = this.style.paper;
    if (document.activeElement?.type !== 'number') this.syncCanvasInputs();
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t instanceof HTMLInputElement && !['range', 'checkbox', 'color'].includes(t.type);
      if (typing || $('#dialog').open) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        return e.shiftKey ? this.redo() : this.undo();
      }
      if (mod && key === 'y') {
        e.preventDefault();
        return this.redo();
      }
      if (mod && key === 'd') {
        e.preventDefault();
        return this.action('duplicate');
      }
      if (mod && key === 'c') return this.action('copy');
      if (mod && key === 'v') return this.action('paste');
      if (mod && key === 'a') {
        e.preventDefault();
        return this.action('select-all');
      }
      if (mod) return;
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        this.spaceDown = true;
        if (!this.gesture) this.stage.dataset.panning = 'true';
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return this.action('delete');
      }
      if (e.key === 'Escape') {
        this.closeSheets();
        return this.setSelection([]);
      }
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (nudge && this.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        return this.commit(updateElements(this.doc, this.selection, (el) => ({ x: el.x + nudge[0] * step, y: el.y + nudge[1] * step })));
      }
      const map = { v: () => this.setTool('select'), b: () => this.setTool('draw'), p: () => this.setTool('draw'), e: () => this.setTool('eraser'),
        ']': () => this.action('forward'), '[': () => this.action('backward'), '}': () => this.action('forward', { toEnd: true }),
        '{': () => this.action('backward', { toEnd: true }), '+': () => this.zoomCenter(1.25), '=': () => this.zoomCenter(1.25),
        '-': () => this.zoomCenter(0.8), '0': () => this.fitView() };
      if (map[e.key] || map[key]) {
        e.preventDefault();
        (map[e.key] || map[key])();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        if (this.gesture?.type !== 'pan') this.stage.dataset.panning = 'false';
      }
    });
    window.addEventListener('blur', () => {
      this.spaceDown = false;
      this.stage.dataset.panning = 'false';
    });
  }

  /** Keeps bottom sheets above the on-screen keyboard (iOS does not resize the layout). */
  bindViewportResize() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(overlap)}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }

  // ------------------------------------------------------------------ dialogs

  ask({ title, message, buttons }) {
    const dialog = $('#dialog');
    $('.dialog-title', dialog).textContent = title;
    $('.dialog-message', dialog).textContent = message;
    const box = $('.dialog-buttons', dialog);
    box.replaceChildren();
    return new Promise((resolve) => {
      let result = buttons[0].value; // Escape / backdrop = first (safe) option
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.textContent = b.label;
        if (b.kind) btn.className = b.kind;
        btn.addEventListener('click', () => {
          result = b.value;
        });
        box.append(btn);
      }
      dialog.addEventListener('close', () => resolve(result), { once: true });
      dialog.showModal();
      box.lastElementChild.focus();
    });
  }

  toast(message) {
    const t = $('#toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
}

const normalizeAngle = (a) => {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 1000) / 1000;
};

// Exposed for debugging and automated browser checks.
window.quillingEditor = new Editor();
