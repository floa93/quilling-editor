import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePath, flattenPath, pathBBox, parseTransform, multiply, invert, apply,
  pointsToPath, smoothPoints, simplifyPoints, distToPolylines, pointInPolylines,
} from '../src/geometry.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('parsePath handles absolute and relative commands', () => {
  const segs = parsePath('M10 10 l10 0 h5 v5 H0 V0 z');
  assert.deepEqual(segs.map((s) => s.type), ['M', 'L', 'L', 'L', 'L', 'L', 'Z']);
  assert.deepEqual(segs[1].points[0], [20, 10]);
  assert.deepEqual(segs[3].points[0], [25, 15]);
});

test('parsePath treats extra coordinate pairs after M as lineto', () => {
  const segs = parsePath('M0 0 10 0 10 10');
  assert.deepEqual(segs.map((s) => s.type), ['M', 'L', 'L']);
});

test('parsePath converts curves and arcs (packed flags)', () => {
  const segs = parsePath('M0 0Q10 10 20 0T40 0S50 10 60 0a10 10 0 0110 10');
  assert.ok(segs.every((s) => ['M', 'C'].includes(s.type)));
  const last = segs[segs.length - 1].points[2];
  close(last[0], 70);
  close(last[1], 10);
});

test('parsePath rejects malformed data', () => {
  assert.throws(() => parsePath('10 10'));
  assert.throws(() => parsePath('M10'));
  assert.throws(() => parsePath('M0 0 X 1'));
  assert.throws(() => parsePath('M0 0Z 5 5'));
});

test('arc bounding box is a full circle', () => {
  const b = pathBBox('M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z');
  close(b.x, 0, 0.5);
  close(b.width, 100, 0.5);
  close(b.height, 100, 0.5);
});

test('parseTransform composes in SVG order and inverts', () => {
  const m = parseTransform('translate(10 20) rotate(90) scale(2)');
  const p = apply(m, [1, 0]);
  close(p[0], 10);
  close(p[1], 22);
  const back = apply(invert(m), p);
  close(back[0], 1);
  close(back[1], 0);
  const r = apply(parseTransform('rotate(180 5 5)'), [0, 0]);
  close(r[0], 10);
  close(r[1], 10);
  assert.deepEqual(multiply([1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 3, 4]), [2, 0, 0, 2, 3, 4]);
});

test('pointsToPath creates a smooth cubic path through all points', () => {
  const pts = [[0, 0], [10, 10], [20, 0], [30, 10]];
  const d = pointsToPath(pts);
  assert.match(d, /^M0 0C/);
  assert.equal((d.match(/C/g) || []).length, 3);
  const flat = flattenPath(d)[0].points;
  assert.deepEqual(flat[flat.length - 1], [30, 10]);
});

test('smoothing keeps endpoints, simplify drops close points', () => {
  const pts = [[0, 0], [0.2, 0.1], [5, 5], [10, 0]];
  assert.equal(simplifyPoints(pts, 1).length, 3);
  const s = smoothPoints([[0, 0], [5, 10], [10, 0]], 1);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s[2], [10, 0]);
  assert.deepEqual(s[1], [5, 5]);
});

test('hit testing helpers', () => {
  const lines = flattenPath('M0 0L10 0L10 10L0 10Z');
  close(distToPolylines([5, 3], lines), 3);
  assert.equal(pointInPolylines([5, 5], lines), true);
  assert.equal(pointInPolylines([15, 5], lines), false);
});
