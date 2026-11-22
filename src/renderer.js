// Renders the document into the live SVG canvas and draws the selection overlay.
// Element nodes are cached per id and only touched when the element object changes.
import { strokeLayers } from './svg.js';
import { elementCorners, transformAttribute, unionBox, worldBox, localBox } from './model.js';
import { fmt } from './geometry.js';
import { textNodes, glyphNode, maskIdFor } from './text.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
const svgEl = (name, attrs = {}) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('quill:')) continue; // export-only metadata
    if (k === 'xml:space') n.setAttributeNS(XMLNS, k, v);
    else n.setAttribute(k, v);
  }
  return n;
};

/** Builds DOM nodes from a {name, attrs, children | text} description (see text.js). */
function specToDom(spec) {
  const n = svgEl(spec.name, spec.attrs);
  if (spec.text != null) n.textContent = spec.text;
  for (const c of spec.children || []) n.append(specToDom(c));
  return n;
}

export class Renderer {
  constructor(svg) {
    this.svg = svg;
    this.viewport = svgEl('g', { class: 'viewport' });
    this.shadow = svgEl('rect', { class: 'artboard-shadow' });
    this.artboard = svgEl('rect', { class: 'artboard' });
    this.layer = svgEl('g', { class: 'elements' });
    this.live = svgEl('path', { class: 'live-stroke', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    this.ghost = svgEl('g', { class: 'drop-ghost' });
    this.overlay = svgEl('g', { class: 'overlay' });
    this.measurer = svgEl('g', { visibility: 'hidden', 'aria-hidden': 'true' });
    this.viewport.append(this.shadow, this.artboard, this.layer, this.live, this.ghost);
    svg.append(this.measurer, this.viewport, this.overlay);
    this.nodes = new Map(); // id -> {el, node}
    this.order = [];
  }

  setView(view) {
    this.viewport.setAttribute('transform', `translate(${fmt(view.x)} ${fmt(view.y)}) scale(${view.zoom})`);
  }

  renderDocument(doc) {
    for (const r of [this.shadow, this.artboard]) {
      r.setAttribute('width', doc.width);
      r.setAttribute('height', doc.height);
    }
    this.artboard.setAttribute('fill', doc.background);

    const seen = new Set();
    const order = [];
    for (const el of doc.elements) {
      seen.add(el.id);
      order.push(el.id);
      const cached = this.nodes.get(el.id);
      if (!cached) {
        this.nodes.set(el.id, { el, node: buildNode(el) });
      } else if (cached.el !== el) {
        if (sameLook(cached.el, el)) cached.node.setAttribute('transform', transformAttribute(el));
        else {
          const node = buildNode(el);
          cached.node.replaceWith(node);
          cached.node = node;
        }
        cached.el = el;
      }
    }
    for (const [id, cached] of this.nodes) {
      if (!seen.has(id)) {
        cached.node.remove();
        this.nodes.delete(id);
      }
    }
    const changed = order.length !== this.order.length || order.some((id, i) => id !== this.order[i]);
    if (changed) {
      const frag = document.createDocumentFragment();
      for (const id of order) frag.append(this.nodes.get(id).node);
      this.layer.append(frag);
      this.order = order;
    }
  }

  /** Measures the glyph box of a text element in local (unscaled) units, or null. */
  measureText(el) {
    const node = specToDom(glyphNode(el));
    this.measurer.replaceChildren(node);
    try {
      const b = node.getBBox();
      return b.width > 0 || b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    } catch {
      return null;
    } finally {
      node.remove();
    }
  }

  setLiveStroke(d, color, width) {
    if (!d) {
      this.live.removeAttribute('d');
      return;
    }
    this.live.setAttribute('d', d);
    this.live.setAttribute('stroke', color);
    this.live.setAttribute('stroke-width', width);
  }

  setGhost(el) {
    this.ghost.replaceChildren();
    if (el) {
      const node = buildNode(el, { ghost: true });
      node.setAttribute('opacity', '0.6');
      this.ghost.append(node);
    }
  }

  /**
   * Draws selection boxes and handles in screen space.
   * `toScreen` maps canvas coordinates to screen coordinates.
   */
  renderOverlay({ elements, toScreen, handleSize, band, hover }) {
    this.overlay.replaceChildren();
    if (hover) {
      this.overlay.append(svgEl('polygon', { class: 'hover-box', points: polyPoints(elementCorners(hover, hover.width / 2).map(toScreen)) }));
    }
    if (band) {
      const a = toScreen([band.x, band.y]);
      const b = toScreen([band.x + band.width, band.y + band.height]);
      this.overlay.append(svgEl('rect', {
        class: 'rubber-band', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]),
      }));
    }
    if (!elements.length) return null;
    for (const el of elements) {
      this.overlay.append(svgEl('polygon', { class: 'select-box', points: polyPoints(elementCorners(el, el.width / 2).map(toScreen)) }));
    }
    const frame = selectionFrame(elements);
    const corners = expandFrame(frame.corners.map(toScreen), handleSize * 3);
    if (elements.length > 1) this.overlay.append(svgEl('polygon', { class: 'group-box', points: polyPoints(corners) }));
    const topMid = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    const center = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
    const up = normalize([topMid[0] - center[0], topMid[1] - center[1]], [0, -1]);
    const rot = [topMid[0] + up[0] * (handleSize * 2.4), topMid[1] + up[1] * (handleSize * 2.4)];
    this.overlay.append(svgEl('line', { class: 'rotate-stem', x1: topMid[0], y1: topMid[1], x2: rot[0], y2: rot[1] }));
    this.overlay.append(svgEl('circle', { class: 'handle rotate', cx: rot[0], cy: rot[1], r: handleSize / 2 + 1 }));
    corners.forEach((c, i) => {
      this.overlay.append(svgEl('rect', {
        class: 'handle', 'data-corner': i, x: c[0] - handleSize / 2, y: c[1] - handleSize / 2,
        width: handleSize, height: handleSize, rx: 2,
      }));
    });
    return { corners, rotate: rot, center };
  }
}

/** Grows a (rotated) screen-space box around its center so handles never cover small shapes. */
function expandFrame(c, minSize) {
  const center = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
  const ax = [c[1][0] - c[0][0], c[1][1] - c[0][1]];
  const ay = [c[3][0] - c[0][0], c[3][1] - c[0][1]];
  const w = Math.hypot(ax[0], ax[1]);
  const h = Math.hypot(ay[0], ay[1]);
  const ux = normalize(ax, [1, 0]);
  const uy = normalize(ay, [-ux[1], ux[0]]);
  const hw = Math.max(w, minSize) / 2;
  const hh = Math.max(h, minSize) / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [
    center[0] + ux[0] * x + uy[0] * y,
    center[1] + ux[1] * x + uy[1] * y,
  ]);
}

function normalize(v, fallback) {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-6 ? [v[0] / len, v[1] / len] : fallback;
}

const polyPoints = (pts) => pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ');

/**
 * The frame used for transform handles: the rotated box for one element,
 * the axis-aligned union box for several.
 */
export function selectionFrame(elements) {
  if (elements.length === 1) {
    const el = elements[0];
    return { corners: elementCorners(el, el.width / 2), single: true };
  }
  const b = unionBox(elements.map(worldBox));
  return {
    corners: [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]],
    single: false,
  };
}

function sameLook(a, b) {
  return a.d === b.d && a.color === b.color && a.width === b.width && a.fill === b.fill && a.paper === b.paper &&
    a.base === b.base && a.pivot === b.pivot && a.text === b.text;
}

let ghostCount = 0;

export function buildNode(el, { ghost = false } = {}) {
  const g = svgEl('g', { transform: transformAttribute(el), 'data-id': el.id });
  if (el.kind === 'text') {
    const maskId = ghost ? `qghost-${++ghostCount}` : maskIdFor(el.id);
    for (const spec of textNodes(el, maskId, localBox(el))) g.append(specToDom(spec));
    return g;
  }
  for (const layer of strokeLayers(el)) {
    const p = svgEl('path', {
      d: el.d,
      fill: layer.fill,
      stroke: layer.stroke,
      'stroke-width': layer.width,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    if (layer.opacity !== 1) p.setAttribute('stroke-opacity', layer.opacity);
    g.append(p);
  }
  return g;
}

/** Small standalone SVG preview for the template library. */
export function previewSvg(d, color = 'currentColor') {
  return `<svg viewBox="-48 -48 96 96" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
