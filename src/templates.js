// Quilling shape templates. Every template is generated as a single continuous
// strip path (a coil/spiral or a scroll), so it looks like rolled paper rather than
// a filled outline. Paths are centered at (0, 0) in local coordinates.
import { pointsToPath, simplifyPoints, bboxOfPoints } from './geometry.js';

const TAU = Math.PI * 2;
export const TEMPLATE_SIZE = 80; // largest dimension in px at scale 1

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Sharp radial bump at angle `at` (creates a pinched point). */
const pinch = (theta, at, amount, width) => amount * Math.max(0, 1 - Math.abs(wrap(theta - at)) / width) ** 2;
/** Polar radius of a regular polygon with a corner at angle `rot`. */
const polygonRadius = (theta, n, rot) => {
  const seg = TAU / n;
  const a = (((theta - rot) % seg) + seg) % seg;
  return Math.cos(Math.PI / n) / Math.cos(a - Math.PI / n);
};
const polar = (r, theta) => [r * Math.cos(theta), r * Math.sin(theta)];

// Outline functions map an angle to a point of the outer shape (unit size, y down).
const OUTLINES = {
  circle: (t) => polar(1, t),
  teardrop: (t) => polar(0.85 + pinch(t, -Math.PI / 2, 0.95, 1.5), t),
  marquise: (t) => {
    const [x, y] = polar(1 + pinch(t, 0, 0.55, 1.4) + pinch(t, Math.PI, 0.55, 1.4), t);
    return [x, y * 0.62];
  },
  // Squircle: a square with the slightly rounded corners of pressed paper.
  square: (t) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [Math.sign(c) * Math.abs(c) ** 0.25, Math.sign(s) * Math.abs(s) ** 0.25];
  },
  triangle: (t) => polar(polygonRadius(t, 3, -Math.PI / 2), t),
  halfMoon: (t) => {
    const [x, y] = polar(1, t);
    return [x, Math.min(y, 0.3)];
  },
  heart: (t) => {
    const u = t + Math.PI / 2;
    const x = 16 * Math.sin(u) ** 3;
    const y = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u));
    return [x / 16, (y - 2) / 16];
  },
  leaf: (t) => {
    const [x, y] = OUTLINES.marquise(t);
    return [x, y + 0.28 * (x * x - 0.5)];
  },
};

/**
 * Builds a coil: a spiral that starts in the center and ends in the given outline,
 * followed by one glued outer wrap. Inner turns are progressively less deformed,
 * like a loose coil pinched into shape.
 */
function coil({ outline = 'circle', turns = 6, inner = 0.06, spread = 0.8, wrap: outerWrap = 1, perTurn = 18 }) {
  const shape = OUTLINES[outline];
  const pts = [];
  const steps = Math.round(turns * perTurn);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = t * turns * TAU - Math.PI / 2;
    const f = inner + (1 - inner) * t ** spread;
    const blend = f ** 2.5;
    const c = polar(1, theta);
    const s = shape(theta);
    pts.push([f * (c[0] + (s[0] - c[0]) * blend), f * (c[1] + (s[1] - c[1]) * blend)]);
  }
  const wrapSteps = Math.round(outerWrap * perTurn * 1.5);
  for (let i = 1; i <= wrapSteps; i++) {
    const theta = -Math.PI / 2 + (i / wrapSteps) * outerWrap * TAU;
    pts.push(shape(theta).map((v) => v * 1.0));
  }
  return pts;
}

/** Integrates a curvature profile kappa(u), u in [-1, 1], into a strip centerline. */
function scroll(kappa, { length = 10, steps = 900 } = {}) {
  const pts = [[0, 0]];
  let x = 0;
  let y = 0;
  let heading = 0;
  const ds = length / steps;
  for (let i = 0; i < steps; i++) {
    const u = -1 + (2 * (i + 0.5)) / steps;
    heading += kappa(u) * ds;
    x += Math.cos(heading) * ds;
    y += Math.sin(heading) * ds;
    pts.push([x, y]);
  }
  return pts;
}

function rotatePoints(pts, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

/** Centers points at the origin and scales the largest dimension to `size`. */
function normalize(pts, size = TEMPLATE_SIZE) {
  const b = bboxOfPoints(pts);
  const k = size / Math.max(b.width, b.height);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return pts.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
}

const curl = (u, power = 2) => Math.abs(u) ** power;

export const TEMPLATES = [
  { id: 'tight-coil', name: 'Tight coil', build: () => coil({ turns: 10, inner: 0.05, spread: 1, wrap: 0.25 }) },
  { id: 'loose-coil', name: 'Loose coil', build: () => coil({ turns: 6, inner: 0.05, spread: 0.7, wrap: 0.25 }) },
  { id: 'teardrop', name: 'Teardrop', build: () => coil({ outline: 'teardrop', perTurn: 22 }) },
  { id: 'marquise', name: 'Marquise (eye)', build: () => coil({ outline: 'marquise', perTurn: 22 }) },
  { id: 'square', name: 'Square', build: () => coil({ outline: 'square', perTurn: 24 }) },
  { id: 'triangle', name: 'Triangle', build: () => coil({ outline: 'triangle', perTurn: 24 }) },
  { id: 'half-moon', name: 'Half moon', build: () => coil({ outline: 'halfMoon', perTurn: 22 }) },
  { id: 'heart', name: 'Heart', build: () => coil({ outline: 'heart', perTurn: 26 }) },
  { id: 'leaf', name: 'Leaf / bent marquise', build: () => coil({ outline: 'leaf', perTurn: 22 }) },
  {
    id: 's-scroll',
    name: 'S-scroll',
    build: () => rotatePoints(scroll((u) => 7 * Math.sign(u) * curl(u, 1.6), { length: 10 }), 0),
  },
  {
    id: 'c-scroll',
    name: 'C-scroll',
    build: () => rotatePoints(scroll((u) => 6.5 * curl(u, 1.8) + 0.35, { length: 10 }), 225),
  },
  {
    id: 'v-scroll',
    name: 'V-scroll',
    build: () => {
      // One arm rises from the fold and curls outwards; the other arm is its mirror image.
      const arm = rotatePoints(scroll((u) => -6 * ((u + 1) / 2) ** 2.2, { length: 6.5, steps: 500 }), -112);
      const shifted = arm.map(([x, y]) => [x - arm[0][0], y - arm[0][1]]);
      const mirrored = shifted.map(([x, y]) => [-x, y]).reverse();
      return [...mirrored, ...shifted.slice(1)];
    },
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

const pathCache = new Map();

/** Returns the path data for a template id (centered at 0,0), or null if unknown. */
export function templatePath(id) {
  if (pathCache.has(id)) return pathCache.get(id);
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) return null;
  const pts = simplifyPoints(normalize(tpl.build()), 1.2);
  const d = pointsToPath(pts);
  pathCache.set(id, d);
  return d;
}

export function templateName(id) {
  return TEMPLATES.find((t) => t.id === id)?.name ?? id;
}
