// Document model. Documents and elements are treated as immutable values, which makes
// undo/redo a matter of keeping references to previous documents.
import {
  apply,
  bboxOfPoints,
  flattenPath,
  IDENTITY,
  isIdentity,
  multiply,
  rotate,
  scale,
  translate,
  fmt,
  matrixToString,
} from './geometry.js';

export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 800;
export const DEFAULT_BACKGROUND = '#ffffff';
export const MIN_CANVAS = 50;
export const MAX_CANVAS = 5000;
export const MIN_STRIP = 1;
export const MAX_STRIP = 20;

/** Paper colors commonly found in quilling strip packs. */
export const PALETTE = [
  '#d62839', '#f26a4b', '#f7a325', '#f6d743', '#9bc53d', '#3f8f4f',
  '#2bb3a3', '#3a86ff', '#1d3557', '#8e5bd6', '#e85a9b', '#f4b6c2',
  '#8b5a2b', '#c9a227', '#ffffff', '#222222',
];

export function createDocument(overrides = {}) {
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    background: DEFAULT_BACKGROUND,
    elements: [],
    ...overrides,
  };
}

let counter = 0;
export function newId() {
  counter = (counter + 1) % 1e6;
  return `el-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function normalizeColor(value, fallback = '#000000') {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = v.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)/);
  if (rgb) {
    const ch = (c) => clamp(Math.round(c.endsWith('%') ? (parseFloat(c) * 255) / 100 : parseFloat(c)), 0, 255);
    return `#${[rgb[1], rgb[2], rgb[3]].map((c) => ch(c).toString(16).padStart(2, '0')).join('')}`;
  }
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  return fallback;
}

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080',
  grey: '#808080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00',
  navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000', silver: '#c0c0c0',
  gold: '#ffd700', violet: '#ee82ee', indigo: '#4b0082', crimson: '#dc143c', coral: '#ff7f50',
  salmon: '#fa8072', tomato: '#ff6347', turquoise: '#40e0d0', beige: '#f5f5dc', khaki: '#f0e68c',
};

/**
 * Element fields:
 *  id, kind ('stroke' | 'template' | 'path'), template (name, for kind 'template'),
 *  d (path data in local coordinates), color, width (strip width), fill ('none' or color),
 *  paper (paper-strip look), x/y (where the pivot lands), rotation (deg), sx/sy (scale),
 *  pivot [px, py] (local rotation/scale origin), base (matrix applied before everything, or null).
 */
export function createElement(fields) {
  const el = {
    id: fields.id || newId(),
    kind: fields.kind || 'path',
    template: fields.template || null,
    d: fields.d,
    color: normalizeColor(fields.color, '#000000'),
    width: Number.isFinite(fields.width) ? fields.width : 3,
    fill: fields.fill && fields.fill !== 'none' ? normalizeColor(fields.fill, 'none') : 'none',
    paper: fields.paper !== undefined ? Boolean(fields.paper) : fields.kind !== 'path',
    x: fields.x ?? 0,
    y: fields.y ?? 0,
    rotation: fields.rotation ?? 0,
    sx: fields.sx ?? 1,
    sy: fields.sy ?? 1,
    pivot: fields.pivot || null,
    base: fields.base && !isIdentity(fields.base) ? fields.base : null,
  };
  if (!el.pivot) {
    // Pivot defaults to the center of the geometry, and the element is placed so that
    // it does not move (unless x/y were explicitly given).
    const box = localBox(el);
    el.pivot = [box.x + box.width / 2, box.y + box.height / 2];
    if (fields.x === undefined) el.x = el.pivot[0];
    if (fields.y === undefined) el.y = el.pivot[1];
  }
  return el;
}

export function elementType(el) {
  return el.kind === 'template' ? `template:${el.template}` : el.kind;
}

/** Full local → canvas matrix. */
export function elementMatrix(el) {
  let m = multiply(translate(el.x, el.y), rotate(el.rotation));
  m = multiply(m, scale(el.sx, el.sy));
  m = multiply(m, translate(-el.pivot[0], -el.pivot[1]));
  if (el.base) m = multiply(m, el.base);
  return m;
}

/** Matrix from the "pivot frame" (geometry after `base`) to canvas. */
export function frameMatrix(el) {
  let m = multiply(translate(el.x, el.y), rotate(el.rotation));
  m = multiply(m, scale(el.sx, el.sy));
  return multiply(m, translate(-el.pivot[0], -el.pivot[1]));
}

export function transformAttribute(el) {
  const parts = [`translate(${fmt(el.x)} ${fmt(el.y)})`];
  if (el.rotation) parts.push(`rotate(${fmt(el.rotation)})`);
  if (el.sx !== 1 || el.sy !== 1) parts.push(`scale(${fmt(el.sx)} ${fmt(el.sy)})`);
  parts.push(`translate(${fmt(-el.pivot[0])} ${fmt(-el.pivot[1])})`);
  if (el.base) parts.push(matrixToString(el.base));
  return parts.join(' ');
}

// Geometry cache keyed by path data (+ base matrix). Elements are immutable, so
// identical `d` strings always produce identical geometry.
const geomCache = new Map();
export function geometry(el) {
  const key = el.base ? `${el.d}|${el.base.join(',')}` : el.d;
  let g = geomCache.get(key);
  if (!g) {
    let lines;
    try {
      lines = flattenPath(el.d, 8);
    } catch {
      lines = [];
    }
    if (el.base) lines = lines.map((l) => ({ closed: l.closed, points: l.points.map((p) => apply(el.base, p)) }));
    g = { lines, box: bboxOfPoints(lines.flatMap((l) => l.points)) };
    if (geomCache.size > 5000) geomCache.clear();
    geomCache.set(key, g);
  }
  return g;
}

/** Bounding box in the pivot frame (after base, before x/y/rotation/scale). */
export function localBox(el) {
  return geometry(el).box;
}

/** Corners of the element's (rotated) box in canvas coordinates: tl, tr, br, bl. `pad` is in local units. */
export function elementCorners(el, pad = 0) {
  const b = localBox(el);
  const m = frameMatrix(el);
  const px = pad;
  const py = pad;
  return [
    [b.x - px, b.y - py],
    [b.x + b.width + px, b.y - py],
    [b.x + b.width + px, b.y + b.height + py],
    [b.x - px, b.y + b.height + py],
  ].map((p) => apply(m, p));
}

/** Axis-aligned bounding box in canvas coordinates. */
export function worldBox(el) {
  const half = (el.width / 2) * Math.max(Math.abs(el.sx), Math.abs(el.sy));
  const b = bboxOfPoints(elementCorners(el));
  return { x: b.x - half, y: b.y - half, width: b.width + 2 * half, height: b.height + 2 * half };
}

export function unionBox(boxes) {
  if (!boxes.length) return null;
  const pts = boxes.flatMap((b) => [
    [b.x, b.y],
    [b.x + b.width, b.y + b.height],
  ]);
  return bboxOfPoints(pts);
}

// ---------------------------------------------------------------------------
// Document operations (all return new documents)

export function addElements(doc, els) {
  return { ...doc, elements: [...doc.elements, ...els] };
}

export function removeElements(doc, ids) {
  const set = new Set(ids);
  return { ...doc, elements: doc.elements.filter((e) => !set.has(e.id)) };
}

export function updateElements(doc, ids, fn) {
  const set = new Set(ids);
  return { ...doc, elements: doc.elements.map((e) => (set.has(e.id) ? { ...e, ...fn(e) } : e)) };
}

export function duplicateElements(doc, ids, offset = 20) {
  const set = new Set(ids);
  const copies = doc.elements
    .filter((e) => set.has(e.id))
    .map((e) => ({ ...e, id: newId(), x: e.x + offset, y: e.y + offset }));
  return { doc: addElements(doc, copies), ids: copies.map((c) => c.id) };
}

/** Moves the given elements one step up (dir = 1) or down (dir = -1) in z-order. */
export function reorder(doc, ids, dir) {
  const set = new Set(ids);
  const els = [...doc.elements];
  if (dir > 0) {
    for (let i = els.length - 2; i >= 0; i--) {
      if (set.has(els[i].id) && !set.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
    }
  } else {
    for (let i = 1; i < els.length; i++) {
      if (set.has(els[i].id) && !set.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    }
  }
  return { ...doc, elements: els };
}

/** Moves elements to the very front (dir = 1) or back (dir = -1). */
export function reorderToEnd(doc, ids, dir) {
  const set = new Set(ids);
  const picked = doc.elements.filter((e) => set.has(e.id));
  const rest = doc.elements.filter((e) => !set.has(e.id));
  return { ...doc, elements: dir > 0 ? [...rest, ...picked] : [...picked, ...rest] };
}

export { IDENTITY };
