// Text elements: outlined "bubble" letters meant to be filled in with quilling coils.
//
// A text element is drawn as an outline ring around each glyph: the glyphs are grown by
// `grow` units and only a ring of the strip width remains visible (the inside is cut out
// with a mask, so the letters are hollow and anything placed beneath shows through).
// Growing thin glyphs makes them wide enough to fill with coils, e.g. after printing.
//
// The element's `d` is just its bounding box (used for selection and hit testing). It is
// measured in the browser; `estimateTextBox` provides a rough fallback (e.g. in Node).
import { fmt } from './geometry.js';

/** System font stacks only: they work offline and in the PNG export (SVG rendered as an image). */
export const FONTS = [
  { id: 'rounded', name: 'Rounded', family: "'Arial Rounded MT Bold', ui-rounded, 'SF Pro Rounded', 'Varela Round', 'Nunito', 'Segoe UI', Arial, sans-serif" },
  { id: 'sans', name: 'Sans serif', family: "Arial, Helvetica, 'Liberation Sans', sans-serif" },
  { id: 'heavy', name: 'Heavy', family: "'Arial Black', 'Helvetica Neue', Impact, sans-serif" },
  { id: 'serif', name: 'Serif', family: "Georgia, 'Times New Roman', Times, serif" },
  { id: 'typewriter', name: 'Typewriter', family: "'Courier New', Courier, monospace" },
  { id: 'hand', name: 'Handwriting', family: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive" },
  { id: 'script', name: 'Script', family: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive" },
];
export const FONT_IDS = FONTS.map((f) => f.id);
export const TEXT_CASES = ['none', 'upper', 'lower'];

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 1000;
export const MAX_GROW = 100;
export const MAX_TEXT_LENGTH = 500;
export const LINE_HEIGHT = 1.15;

export const DEFAULT_TEXT = {
  content: 'ABC',
  font: 'rounded',
  size: 160,
  bold: true,
  italic: false,
  case: 'none',
  grow: 8,
  spacing: 6,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);

/** Returns a complete, valid set of text properties. */
export function normalizeText(t = {}) {
  const content = typeof t.content === 'string' ? t.content.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_LENGTH) : DEFAULT_TEXT.content;
  return {
    content,
    font: FONT_IDS.includes(t.font) ? t.font : DEFAULT_TEXT.font,
    size: clamp(finite(t.size, DEFAULT_TEXT.size), MIN_FONT_SIZE, MAX_FONT_SIZE),
    bold: t.bold === undefined ? DEFAULT_TEXT.bold : t.bold === true || t.bold === '1' || t.bold === 1,
    italic: t.italic === true || t.italic === '1' || t.italic === 1,
    case: TEXT_CASES.includes(t.case) ? t.case : 'none',
    grow: clamp(finite(t.grow, DEFAULT_TEXT.grow), 0, MAX_GROW),
    spacing: clamp(finite(t.spacing, DEFAULT_TEXT.spacing), -200, 200),
  };
}

/** The lines as displayed (case applied). */
export function displayLines(t) {
  const s = t.case === 'upper' ? t.content.toUpperCase() : t.case === 'lower' ? t.content.toLowerCase() : t.content;
  return s.split('\n');
}

export const fontFamily = (id) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).family;

/**
 * Space between letters / lines. `spacing` is the gap between neighbouring outlines, so the
 * grown outlines are added on top: letters stay separate however wide they are made
 * (a negative spacing lets them merge into one bubble shape).
 */
export const letterSpacing = (el) => el.text.spacing + 2 * (el.text.grow + el.width);
export const lineStep = (el) => el.text.size * LINE_HEIGHT + 2 * (el.text.grow + el.width);

/** Font attributes shared by all <text> nodes of an element. */
function fontAttrs(el) {
  const t = el.text;
  const attrs = {
    'font-family': fontFamily(t.font),
    'font-size': fmt(t.size),
    'font-weight': t.font === 'heavy' ? '900' : t.bold ? '700' : '400',
  };
  if (t.italic) attrs['font-style'] = 'italic';
  const spacing = letterSpacing(el);
  if (spacing) attrs['letter-spacing'] = fmt(spacing);
  attrs['xml:space'] = 'preserve';
  return attrs;
}

/** One <tspan> per line; the first baseline is at y = 0. */
function lineNodes(el) {
  return displayLines(el.text).map((line, i) => ({
    name: 'tspan',
    attrs: { x: '0', y: fmt(i * lineStep(el)) },
    text: line,
  }));
}

/** Plain glyph text of an element (used for measuring). */
export function glyphNode(el) {
  return { name: 'text', attrs: fontAttrs(el), children: lineNodes(el) };
}

/** Amount by which the visible drawing extends beyond the glyph boxes. */
export const textPadding = (el) => el.text.grow + el.width;

/**
 * Bounding box path from a measured glyph box. It is padded by the grown outline except
 * for half the strip width, which selection boxes and hit testing add themselves.
 */
export function textBoxPath(glyphBox, el) {
  const pad = el.text.grow + el.width / 2 + el.text.size * 0.03;
  const x = glyphBox.x - pad;
  const y = glyphBox.y - pad;
  const w = Math.max(glyphBox.width, 1) + pad * 2;
  const h = Math.max(glyphBox.height, 1) + pad * 2;
  return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
}

/** Rough glyph box of an element without a browser (average glyph width ~0.6 em). */
export function estimateTextBox(el) {
  const t = el.text;
  const lines = displayLines(t);
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const em = t.font === 'heavy' ? 0.75 : t.bold ? 0.66 : 0.6;
  return {
    x: 0,
    y: -t.size * 0.92,
    width: longest * (t.size * em + letterSpacing(el)),
    height: t.size * 1.17 + (lines.length - 1) * lineStep(el),
  };
}

/**
 * Describes the SVG nodes that draw a text element (in its local coordinates), as a tree
 * of {name, attrs, children | text}. Shared by the live canvas and the SVG exporter.
 * `box` is the element's local bounding box, used as the mask region.
 */
export function textNodes(el, maskId, box) {
  const t = el.text;
  const pad = textPadding(el) + t.size * 0.2;
  const region = {
    x: fmt(box.x - pad), y: fmt(box.y - pad), width: fmt(box.width + pad * 2), height: fmt(box.height + pad * 2),
  };
  const outer = 2 * (t.grow + el.width);
  const inner = 2 * t.grow;
  const round = { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  const hole = { ...glyphNode(el), attrs: { ...fontAttrs(el), fill: '#000000', ...(inner > 0 ? { stroke: '#000000', 'stroke-width': fmt(inner), ...round } : {}) } };
  return [
    {
      name: 'defs',
      children: [{
        name: 'mask',
        attrs: { id: maskId, maskUnits: 'userSpaceOnUse', ...region },
        children: [{ name: 'rect', attrs: { ...region, fill: '#ffffff' } }, hole],
      }],
    },
    {
      name: 'text',
      attrs: {
        'quill:role': 'outline', ...fontAttrs(el), fill: el.color, stroke: el.color, 'stroke-width': fmt(outer), ...round,
        mask: `url(#${maskId})`,
      },
      children: lineNodes(el),
    },
  ];
}

export const maskIdFor = (id) => `qmask-${id}`;
