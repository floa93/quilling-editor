import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templatePath, TEMPLATE_SIZE } from '../src/templates.js';
import { parsePath, pathBBox, flattenPath } from '../src/geometry.js';

const REQUIRED = [
  'Tight coil', 'Loose coil', 'Teardrop', 'Marquise', 'Square', 'Triangle',
  'Half moon', 'Heart', 'Leaf', 'S-scroll', 'C-scroll', 'V-scroll',
];

test('library contains all required basic shapes', () => {
  for (const name of REQUIRED) {
    assert.ok(TEMPLATES.some((t) => t.name.startsWith(name)), `missing ${name}`);
  }
});

for (const tpl of TEMPLATES) {
  test(`template ${tpl.id} is a single valid strip centered at the origin`, () => {
    const d = templatePath(tpl.id);
    const segs = parsePath(d);
    assert.equal(segs.filter((s) => s.type === 'M').length, 1, 'one continuous strip');
    assert.ok(segs.length > 20, 'curved coil/scroll, not a simple outline');
    const b = pathBBox(d);
    assert.ok(Math.abs(Math.max(b.width, b.height) - TEMPLATE_SIZE) < 4, `size ${b.width}x${b.height}`);
    assert.ok(Math.abs(b.x + b.width / 2) < 3 && Math.abs(b.y + b.height / 2) < 3, 'centered');
    assert.equal(templatePath(tpl.id), d, 'deterministic');
  });
}

test('coils wind around their center several times', () => {
  for (const id of ['tight-coil', 'loose-coil', 'teardrop', 'heart']) {
    const pts = flattenPath(templatePath(id))[0].points;
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      let a = Math.atan2(pts[i][1], pts[i][0]) - Math.atan2(pts[i - 1][1], pts[i - 1][0]);
      a = Math.atan2(Math.sin(a), Math.cos(a));
      total += a;
    }
    assert.ok(Math.abs(total) / (2 * Math.PI) >= 4, `${id} winds ${total / (2 * Math.PI)} times`);
  }
});

test('unknown template returns null', () => {
  assert.equal(templatePath('nope'), null);
});
