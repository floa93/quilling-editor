import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocument, createElement, addElements, elementMatrix, flipElements, normalizeAngle,
} from '../src/model.js';
import { apply } from '../src/geometry.js';
import { templatePath } from '../src/templates.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

function sample() {
  const el = createElement({
    kind: 'template', template: 'teardrop', d: templatePath('teardrop'), color: '#d62839', width: 4,
    x: 120, y: 80, rotation: 33, sx: 1.4, sy: 0.7,
  });
  return { doc: addElements(createDocument(), [el]), el };
}

for (const [axis, mirror] of [
  ['x', ([x, y], c) => [2 * c[0] - x, y]],
  ['y', ([x, y], c) => [x, 2 * c[1] - y]],
]) {
  test(`flip across ${axis} mirrors every point of the element`, () => {
    const { doc, el } = sample();
    const center = [200, 150];
    const flipped = flipElements(doc, [el.id], axis, center).elements[0];
    const m0 = elementMatrix(el);
    const m1 = elementMatrix(flipped);
    for (const p of [[0, 0], [10, -20], [-35, 12]]) {
      const want = mirror(apply(m0, p), center);
      const got = apply(m1, p);
      close(got[0], want[0], 'x');
      close(got[1], want[1], 'y');
    }
    assert.ok(flipped.sy > 0, 'sy stays positive');
  });

  test(`flipping twice across ${axis} restores the element`, () => {
    const { doc, el } = sample();
    const twice = flipElements(flipElements(doc, [el.id], axis, [7, 9]), [el.id], axis, [7, 9]).elements[0];
    for (const k of ['x', 'y', 'rotation', 'sx', 'sy']) close(twice[k], el[k], k);
  });
}

test('normalizeAngle maps into (-180, 180]', () => {
  assert.equal(normalizeAngle(190), -170);
  assert.equal(normalizeAngle(-180), 180);
  assert.equal(normalizeAngle(540), 180);
  assert.equal(normalizeAngle(-30), -30);
});

test('service worker precache list only names files that exist', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const list = JSON.parse(src.match(/const CORE = (\[[^\]]*\])/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const file of list.filter((f) => f !== './')) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `missing ${file}`);
  }
});
