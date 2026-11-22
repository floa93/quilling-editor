// SVG serialization (export) and parsing (import).
//
// Exported files are plain SVG 1.1. Editor metadata lives in attributes of a private
// XML namespace (prefix "quill"), which SVG 1.1 explicitly allows and which viewers ignore.
// Those attributes make the round trip export -> import -> export lossless.
import { parseXml, escapeXml, localName, XmlError } from './xml.js';
import { parsePath, parseTransform, multiply, IDENTITY, fmt, isIdentity, translate, scale } from './geometry.js';
import {
  createDocument,
  createElement,
  elementType,
  transformAttribute,
  normalizeColor,
  clamp,
  MIN_CANVAS,
  MAX_CANVAS,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_BACKGROUND,
} from './model.js';
import { TEMPLATE_IDS } from './templates.js';

export const NS = 'urn:quilling-editor:1';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const FORMAT_VERSION = '1';

export class ImportError extends Error {}

// ---------------------------------------------------------------------------
// Rendering description shared by the live canvas and the exporter

function mix(hex, target, amount) {
  const n = parseInt(hex.slice(1), 16);
  const t = parseInt(target.slice(1), 16);
  const ch = (shift) => {
    const a = (n >> shift) & 255;
    const b = (t >> shift) & 255;
    return Math.round(a + (b - a) * amount);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export const shade = (hex, amount) => mix(hex, '#000000', amount);
export const tint = (hex, amount) => mix(hex, '#ffffff', amount);

/**
 * Describes the <path> layers used to draw an element. The first layer carries the
 * geometry and core attributes; with the paper look, edge shading and a highlight are
 * layered on top (it degrades to a solid strip in viewers that ignore opacity).
 */
export function strokeLayers(el) {
  const base = {
    role: 'strip',
    stroke: el.width > 0 ? el.color : 'none',
    width: el.width,
    fill: el.fill,
    opacity: 1,
  };
  if (!el.paper || el.width < 1.5) return [base];
  return [
    { ...base, stroke: shade(el.color, 0.28) },
    { role: 'paper-face', stroke: el.color, width: el.width * 0.68, fill: 'none', opacity: 1 },
    { role: 'paper-highlight', stroke: tint(el.color, 0.55), width: Math.max(0.4, el.width * 0.18), fill: 'none', opacity: 0.85 },
  ];
}

// ---------------------------------------------------------------------------
// Export

export function exportSvg(doc) {
  const w = fmt(doc.width);
  const h = fmt(doc.height);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="${SVG_NS}" xmlns:quill="${NS}" version="1.1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" quill:version="${FORMAT_VERSION}">`,
    '  <title>Quilling design</title>',
    '  <metadata>Created with Quilling Editor. Element data is stored in quill:* attributes.</metadata>',
    `  <rect quill:role="background" x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(doc.background)}"/>`,
  ];
  for (const el of doc.elements) {
    const attrs = [
      `id="${escapeXml(el.id)}"`,
      `transform="${transformAttribute(el)}"`,
      `quill:type="${escapeXml(elementType(el))}"`,
      `quill:color="${el.color}"`,
      `quill:width="${fmt(el.width)}"`,
      `quill:fill="${el.fill}"`,
      `quill:paper="${el.paper ? 1 : 0}"`,
      `quill:x="${fmt(el.x)}"`,
      `quill:y="${fmt(el.y)}"`,
      `quill:rotation="${fmt(el.rotation)}"`,
      `quill:sx="${fmt(el.sx)}"`,
      `quill:sy="${fmt(el.sy)}"`,
      `quill:pivot="${fmt(el.pivot[0])} ${fmt(el.pivot[1])}"`,
    ];
    if (el.base) attrs.push(`quill:base="${el.base.map(fmt).join(' ')}"`);
    lines.push(`  <g ${attrs.join(' ')}>`);
    for (const layer of strokeLayers(el)) {
      const parts = [
        `quill:role="${layer.role}"`,
        `d="${escapeXml(el.d)}"`,
        `fill="${layer.fill}"`,
        `stroke="${layer.stroke}"`,
        `stroke-width="${fmt(layer.width)}"`,
        'stroke-linecap="round"',
        'stroke-linejoin="round"',
      ];
      if (layer.opacity !== 1) parts.push(`stroke-opacity="${layer.opacity}"`);
      lines.push(`    <path ${parts.join(' ')}/>`);
    }
    lines.push('  </g>');
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Sanitizing

const DANGEROUS_ELEMENTS = new Set([
  'script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas',
  'handler', 'listener', 'set', 'animate', 'animateTransform', 'animateMotion', 'animateColor', 'discard',
]);

const isExternalRef = (v) => !/^\s*#/.test(v);

/**
 * Removes scripts, event handler attributes and external references from a parsed
 * XML tree (in place). Returns the number of removed items.
 */
export function sanitizeTree(node) {
  let removed = 0;
  for (const name of Object.keys(node.attrs)) {
    const value = node.attrs[name];
    const lname = localName(name).toLowerCase();
    const bad =
      lname.startsWith('on') ||
      (lname === 'href' && isExternalRef(value)) ||
      /javascript:|data:|url\(\s*['"]?(?!#)/i.test(value) ||
      /expression\s*\(/i.test(value);
    if (bad) {
      delete node.attrs[name];
      removed++;
    }
  }
  node.children = node.children.filter((child) => {
    if (child.type !== 'element') return true;
    if (DANGEROUS_ELEMENTS.has(localName(child.name)) || localName(child.name).toLowerCase() === 'script') {
      removed++;
      return false;
    }
    removed += sanitizeTree(child);
    return true;
  });
  return removed;
}

// ---------------------------------------------------------------------------
// Import

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

function parseLength(v) {
  if (v == null || /%$/.test(String(v).trim())) return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = String(v).trim().replace(/^[-+\d.eE]+/, '');
  const factor = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[unit];
  return factor ? n * factor : n;
}

function parseViewBox(v) {
  if (!v) return null;
  const p = v.trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) return null;
  return p;
}

/**
 * Parses SVG text. Returns {doc, native, skipped} where `native` tells whether the file
 * was produced by this editor. Throws ImportError for invalid input.
 */
export function importSvg(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ImportError('The file is empty.');
  let root;
  try {
    root = parseXml(text);
  } catch (e) {
    if (e instanceof XmlError) throw new ImportError(`The file is not valid SVG/XML: ${e.message}`);
    throw e;
  }
  if (localName(root.name) !== 'svg') throw new ImportError('The file is not an SVG image (missing <svg> root element).');
  sanitizeTree(root);

  const prefix = Object.keys(root.attrs).find((a) => a.startsWith('xmlns:') && root.attrs[a] === NS)?.slice(6);
  if (prefix && root.attrs[`${prefix}:version`]) return { ...importNative(root, prefix), native: true };
  return { ...importGeneric(root), native: false };
}

function canvasSize(root) {
  const vb = parseViewBox(root.attrs.viewBox);
  let width = parseLength(root.attrs.width) ?? (vb ? vb[2] : null);
  let height = parseLength(root.attrs.height) ?? (vb ? vb[3] : null);
  if (width == null && height != null && vb) width = (height * vb[2]) / vb[3];
  if (height == null && width != null && vb) height = (width * vb[3]) / vb[2];
  return {
    width: clamp(Math.round(width ?? DEFAULT_WIDTH), MIN_CANVAS, MAX_CANVAS),
    height: clamp(Math.round(height ?? DEFAULT_HEIGHT), MIN_CANVAS, MAX_CANVAS),
    rawWidth: width,
    rawHeight: height,
    vb,
  };
}

function importNative(root, p) {
  const { width, height } = canvasSize(root);
  const attr = (node, name) => node.attrs[`${p}:${name}`];
  let background = DEFAULT_BACKGROUND;
  const elements = [];
  let skipped = 0;
  for (const node of root.children) {
    if (node.type !== 'element') continue;
    if (attr(node, 'role') === 'background') {
      background = normalizeColor(node.attrs.fill, DEFAULT_BACKGROUND);
      continue;
    }
    const type = attr(node, 'type');
    if (!type) continue;
    const strip = node.children.find((c) => c.type === 'element' && localName(c.name) === 'path' && attr(c, 'role') === 'strip')
      || node.children.find((c) => c.type === 'element' && localName(c.name) === 'path');
    if (!strip || !isValidPath(strip.attrs.d)) {
      skipped++;
      continue;
    }
    let kind = type;
    let template = null;
    if (type.startsWith('template:')) {
      kind = 'template';
      template = type.slice(9);
      if (!TEMPLATE_IDS.includes(template)) kind = 'path';
    } else if (type !== 'stroke' && type !== 'path') kind = 'path';
    const pivot = (attr(node, 'pivot') || '').split(/[\s,]+/).map(Number);
    const base = (attr(node, 'base') || '').split(/[\s,]+/).filter(Boolean).map(Number);
    elements.push(
      createElement({
        id: sanitizeId(node.attrs.id),
        kind,
        template: kind === 'template' ? template : null,
        d: strip.attrs.d,
        color: normalizeColor(attr(node, 'color'), '#000000'),
        width: clamp(num(attr(node, 'width'), 3), 0, 200),
        fill: attr(node, 'fill') || 'none',
        paper: attr(node, 'paper') === '1',
        x: num(attr(node, 'x')),
        y: num(attr(node, 'y')),
        rotation: num(attr(node, 'rotation')),
        sx: num(attr(node, 'sx'), 1) || 1,
        sy: num(attr(node, 'sy'), 1) || 1,
        pivot: pivot.length === 2 && pivot.every(Number.isFinite) ? pivot : null,
        base: base.length === 6 && base.every(Number.isFinite) ? base : null,
      }),
    );
  }
  return { doc: createDocument({ width, height, background, elements }), skipped };
}

function sanitizeId(id) {
  return typeof id === 'string' && /^[A-Za-z][-\w.]{0,80}$/.test(id) ? id : undefined;
}

function isValidPath(d) {
  if (!d || typeof d !== 'string') return false;
  try {
    return parsePath(d).length > 0;
  } catch {
    return false;
  }
}

const SKIP = new Set([
  'defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient',
  'filter', 'style', 'metadata', 'title', 'desc', 'text', 'image', 'use', 'switch-fallback',
]);
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
const INHERITED = ['fill', 'stroke', 'stroke-width', 'visibility'];

function parseStyle(style) {
  const out = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

function shapeToPath(name, a) {
  const n = (k) => num(a[k]);
  switch (name) {
    case 'path':
      return a.d;
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx != null ? n('rx') : a.ry != null ? n('ry') : 0;
      let ry = a.ry != null ? n('ry') : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (!rx || !ry) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
      return (
        `M${fmt(x + rx)} ${fmt(y)}H${fmt(x + w - rx)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}` +
        `V${fmt(y + h - ry)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)}H${fmt(x + rx)}` +
        `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}V${fmt(y + ry)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)}Z`
      );
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx');
      const cy = n('cy');
      const rx = name === 'circle' ? n('r') : n('rx');
      const ry = name === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
    }
    case 'line':
      return `M${fmt(n('x1'))} ${fmt(n('y1'))}L${fmt(n('x2'))} ${fmt(n('y2'))}`;
    case 'polyline':
    case 'polygon': {
      const v = (a.points || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
      if (v.length < 4) return null;
      let d = `M${fmt(v[0])} ${fmt(v[1])}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${fmt(v[i])} ${fmt(v[i + 1])}`;
      return name === 'polygon' ? `${d}Z` : d;
    }
    default:
      return null;
  }
}

function paintColor(value) {
  if (value == null) return undefined;
  const v = String(value).trim();
  if (v === 'none' || v === 'transparent') return 'none';
  if (/^url\(/i.test(v)) return '#999999'; // gradients/patterns are not supported: use neutral gray
  if (v === 'currentColor' || v === 'inherit') return undefined;
  return normalizeColor(v, '#000000');
}

function coversCanvas(a, m, size) {
  const full = size.vb ? [size.vb[2], size.vb[3]] : [size.width, size.height];
  const w = a.width === '100%' ? full[0] : num(a.width);
  const h = a.height === '100%' ? full[1] : num(a.height);
  const x = num(a.x);
  const y = num(a.y);
  if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) return false; // rotated
  const p0 = [m[0] * x + m[4], m[3] * y + m[5]];
  const p1 = [m[0] * (x + w) + m[4], m[3] * (y + h) + m[5]];
  return Math.min(p0[0], p1[0]) <= 0.5 && Math.min(p0[1], p1[1]) <= 0.5 &&
    Math.max(p0[0], p1[0]) >= size.width - 0.5 && Math.max(p0[1], p1[1]) >= size.height - 0.5;
}

function importGeneric(root) {
  const size = canvasSize(root);
  let rootMatrix = [...IDENTITY];
  if (size.vb) {
    const sx = (size.rawWidth ?? size.vb[2]) / size.vb[2];
    const sy = (size.rawHeight ?? size.vb[3]) / size.vb[3];
    const s = Math.min(sx, sy);
    rootMatrix = multiply(scale(s, s), translate(-size.vb[0], -size.vb[1]));
    // Keep proportions as with the default preserveAspectRatio (xMidYMid meet).
    rootMatrix = multiply(translate(((size.rawWidth ?? size.vb[2]) - size.vb[2] * s) / 2, ((size.rawHeight ?? size.vb[3]) - size.vb[3] * s) / 2), rootMatrix);
  }
  const elements = [];
  let skipped = 0;
  let background = DEFAULT_BACKGROUND;

  const walk = (node, matrix, inherited, depth) => {
    if (depth > 64) return;
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const name = localName(child.name);
      const style = { ...inherited };
      const own = parseStyle(child.attrs.style);
      for (const k of INHERITED) {
        if (child.attrs[k] != null) style[k] = child.attrs[k];
        if (own[k] != null) style[k] = own[k];
      }
      const display = own.display ?? child.attrs.display;
      if (display === 'none' || style.visibility === 'hidden') continue;
      if (SKIP.has(name)) continue;
      let m = matrix;
      if (child.attrs.transform) m = multiply(m, parseTransform(child.attrs.transform));
      if (CONTAINERS.has(name)) {
        if (name === 'svg') m = multiply(m, translate(num(child.attrs.x), num(child.attrs.y)));
        walk(child, m, style, depth + 1);
        continue;
      }
      const d = shapeToPath(name, child.attrs);
      if (!d || !isValidPath(d)) {
        skipped++;
        continue;
      }
      const fill = paintColor(style.fill) ?? '#000000'; // SVG default fill is black
      const stroke = paintColor(style.stroke) ?? 'none';
      const strokeWidth = stroke === 'none' ? 0 : Math.max(0, num(style['stroke-width'], 1));
      if (fill === 'none' && stroke === 'none') {
        skipped++;
        continue;
      }
      // A filled rect covering the whole canvas as first element is treated as background.
      if (!elements.length && name === 'rect' && fill !== 'none' && stroke === 'none' && coversCanvas(child.attrs, m, size)) {
        background = fill;
        continue;
      }
      elements.push(
        createElement({
          kind: 'path',
          d,
          base: isIdentity(m) ? null : m,
          color: stroke !== 'none' ? stroke : fill,
          width: strokeWidth,
          fill: name === 'line' ? 'none' : fill,
          paper: false,
        }),
      );
    }
  };
  const rootStyle = parseStyle(root.attrs.style);
  const inherited = {};
  for (const k of INHERITED) inherited[k] = rootStyle[k] ?? root.attrs[k];
  walk(root, rootMatrix, inherited, 0);
  return { doc: createDocument({ width: size.width, height: size.height, background, elements }), skipped };
}
