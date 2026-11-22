// Pure geometry helpers: 2D affine matrices, SVG path parsing/flattening,
// stroke smoothing and hit testing. No DOM access, so everything is unit-testable.

/** Affine matrix [a, b, c, d, e, f] as in SVG: x' = a*x + c*y + e, y' = b*x + d*y + f */
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [...IDENTITY];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m, [x, y]) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function rotate(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Parses an SVG transform attribute into a matrix. Unknown parts are ignored. */
export function parseTransform(str) {
  let m = [...IDENTITY];
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str))) {
    const v = (match[2].match(NUMBER_RE) || []).map(Number);
    let t;
    switch (match[1]) {
      case 'matrix':
        if (v.length === 6) t = v;
        break;
      case 'translate':
        t = translate(v[0] || 0, v[1] || 0);
        break;
      case 'scale':
        t = scale(v[0] ?? 1, v[1] ?? v[0] ?? 1);
        break;
      case 'rotate':
        t = rotate(v[0] || 0);
        if (v.length === 3) t = multiply(multiply(translate(v[1], v[2]), t), translate(-v[1], -v[2]));
        break;
      case 'skewX':
        t = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

export const fmt = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export const matrixToString = (m) => `matrix(${m.map(fmt).join(' ')})`;
export const isIdentity = (m) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

// ---------------------------------------------------------------------------
// Path parsing

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const PARAMS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Context-aware scanner: arc flags may be packed without separators ("a1 1 0 011 1"). */
function makeScanner(d) {
  let pos = 0;
  const skip = () => {
    while (pos < d.length && /[\s,]/.test(d[pos])) pos++;
  };
  const numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  return {
    done() {
      skip();
      return pos >= d.length;
    },
    peekCommand() {
      skip();
      return /[MLHVCSQTAZ]/i.test(d[pos] || '') ? d[pos] : null;
    },
    command() {
      skip();
      return d[pos++];
    },
    hasNumber() {
      skip();
      return /[-+.\d]/.test(d[pos] || '');
    },
    number() {
      skip();
      numRe.lastIndex = pos;
      const m = numRe.exec(d);
      if (!m) throw new Error(`Invalid number in path at ${pos}`);
      pos = numRe.lastIndex;
      return Number(m[0]);
    },
    flag() {
      skip();
      const c = d[pos];
      if (c !== '0' && c !== '1') throw new Error(`Invalid arc flag in path at ${pos}`);
      pos++;
      return Number(c);
    },
  };
}

/**
 * Parses path data into absolute segments:
 * {type:'M'|'L'|'C'|'Z', points:[...]} where C has [c1, c2, end].
 * Q/T/S/H/V/A are converted to L/C. Throws on malformed data.
 */
export function parsePath(d) {
  const sc = makeScanner(String(d || ''));
  const segs = [];
  let cmd = null;
  let cur = [0, 0];
  let start = [0, 0];
  let lastCtrl = null; // for S
  let lastQ = null; // for T
  while (!sc.done()) {
    if (sc.peekCommand()) cmd = sc.command();
    else if (cmd === null || !sc.hasNumber()) throw new Error('Invalid path data');
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    if (!(upper in PARAMS)) throw new Error(`Unknown path command ${cmd}`);
    if (upper === 'Z') {
      segs.push({ type: 'Z', points: [] });
      cur = [...start];
      lastCtrl = lastQ = null;
      cmd = null; // numbers directly after Z are invalid
      continue;
    }
    const args = [];
    for (let k = 0; k < PARAMS[upper]; k++) {
      if (upper === 'A' && (k === 3 || k === 4)) args.push(sc.flag());
      else if (sc.hasNumber()) args.push(sc.number());
      else throw new Error(`Incomplete parameters for ${cmd}`);
    }
    const ox = rel ? cur[0] : 0;
    const oy = rel ? cur[1] : 0;
    const pt = (x, y) => [x + ox, y + oy];
    switch (upper) {
      case 'M':
        cur = pt(args[0], args[1]);
        start = [...cur];
        segs.push({ type: 'M', points: [cur] });
        cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
        lastCtrl = lastQ = null;
        break;
      case 'L':
        cur = pt(args[0], args[1]);
        segs.push({ type: 'L', points: [cur] });
        lastCtrl = lastQ = null;
        break;
      case 'H':
        cur = [args[0] + ox, cur[1]];
        segs.push({ type: 'L', points: [cur] });
        lastCtrl = lastQ = null;
        break;
      case 'V':
        cur = [cur[0], args[0] + oy];
        segs.push({ type: 'L', points: [cur] });
        lastCtrl = lastQ = null;
        break;
      case 'C': {
        const c1 = pt(args[0], args[1]);
        const c2 = pt(args[2], args[3]);
        cur = pt(args[4], args[5]);
        segs.push({ type: 'C', points: [c1, c2, cur] });
        lastCtrl = c2;
        lastQ = null;
        break;
      }
      case 'S': {
        const c1 = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : [...cur];
        const c2 = pt(args[0], args[1]);
        cur = pt(args[2], args[3]);
        segs.push({ type: 'C', points: [c1, c2, cur] });
        lastCtrl = c2;
        lastQ = null;
        break;
      }
      case 'Q':
      case 'T': {
        const q =
          upper === 'Q' ? pt(args[0], args[1]) : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : [...cur];
        const end = upper === 'Q' ? pt(args[2], args[3]) : pt(args[0], args[1]);
        segs.push({ type: 'C', points: quadToCubic(cur, q, end) });
        cur = end;
        lastQ = q;
        lastCtrl = null;
        break;
      }
      case 'A': {
        const end = pt(args[5], args[6]);
        for (const c of arcToCubics(cur, args[0], args[1], args[2], args[3], args[4], end)) {
          segs.push({ type: 'C', points: c });
        }
        cur = end;
        lastCtrl = lastQ = null;
        break;
      }
    }
  }
  if (segs.length && segs[0].type !== 'M') throw new Error('Path must start with M');
  return segs;
}

function quadToCubic(p0, q, p1) {
  return [
    [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    [p1[0] + (2 / 3) * (q[0] - p1[0]), p1[1] + (2 / 3) * (q[1] - p1[1])],
    p1,
  ];
}

/** Converts an SVG elliptical arc to cubic Bézier segments (SVG spec F.6). */
function arcToCubics(p0, rx, ry, phiDeg, largeArc, sweep, p1) {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) {
    return p0[0] === p1[0] && p0[1] === p1[1] ? [] : [[p0, p1, p1]];
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (Boolean(largeArc) === Boolean(sweep)) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / n;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  const point = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  let t = theta1;
  for (let s = 0; s < n; s++) {
    const a = point(t);
    const b = point(t + delta);
    const da = deriv(t);
    const db = deriv(t + delta);
    out.push([
      [a[0] + k * da[0], a[1] + k * da[1]],
      [b[0] - k * db[0], b[1] - k * db[1]],
      s === n - 1 ? p1 : b,
    ]);
    t += delta;
  }
  return out;
}

/**
 * Flattens path data into polylines (one per subpath). Each polyline is
 * {points, closed}. `tolerance` controls Bézier subdivision density.
 */
export function flattenPath(d, steps = 12) {
  const segs = parsePath(d);
  const lines = [];
  let line = null;
  let cur = [0, 0];
  for (const s of segs) {
    if (s.type === 'M') {
      line = { points: [s.points[0]], closed: false };
      lines.push(line);
      cur = s.points[0];
    } else if (s.type === 'L') {
      line.points.push(s.points[0]);
      cur = s.points[0];
    } else if (s.type === 'C') {
      const [c1, c2, end] = s.points;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const mt = 1 - t;
        line.points.push([
          mt * mt * mt * cur[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * end[0],
          mt * mt * mt * cur[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * end[1],
        ]);
      }
      cur = end;
    } else if (s.type === 'Z' && line) {
      line.closed = true;
      line.points.push(line.points[0]);
      cur = line.points[0];
      // A following command without M continues from the subpath start.
      line = { points: [cur], closed: false };
      lines.push(line);
    }
  }
  return lines.filter((l) => l.points.length > 1 || lines.length === 1);
}

export function bboxOfPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pathBBox(d) {
  return bboxOfPoints(flattenPath(d).flatMap((l) => l.points));
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

export function distToPolylines(p, lines) {
  let best = Infinity;
  for (const { points } of lines) {
    if (points.length === 1) best = Math.min(best, Math.hypot(points[0][0] - p[0], points[0][1] - p[1]));
    for (let i = 1; i < points.length; i++) best = Math.min(best, distToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

/** Even-odd point-in-polygon test over closed polylines. */
export function pointInPolylines(p, lines) {
  let inside = false;
  for (const { points, closed } of lines) {
    if (!closed) continue;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Freehand smoothing

/** Drops points closer than `minDist` to the previous kept point. */
export function simplifyPoints(points, minDist = 1.5) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Light moving-average smoothing that keeps the end points fixed. */
export function smoothPoints(points, passes = 2) {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) return pts.slice();
    const next = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      next.push([
        (pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4,
        (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4,
      ]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/**
 * Converts points into a smooth cubic Bézier path using Catmull-Rom splines.
 * With `closed`, the curve wraps around to the first point.
 */
export function pointsToPath(points, closed = false) {
  if (!points.length) return '';
  const p = points;
  if (p.length === 1) return `M${fmt(p[0][0])} ${fmt(p[0][1])}l0 0`;
  if (p.length === 2) return `M${fmt(p[0][0])} ${fmt(p[0][1])}L${fmt(p[1][0])} ${fmt(p[1][1])}`;
  const n = p.length;
  const get = (i) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${fmt(p[0][0])} ${fmt(p[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  if (closed) d += 'Z';
  return d;
}
