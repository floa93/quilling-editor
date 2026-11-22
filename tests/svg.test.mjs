import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSvg, importSvg, ImportError, sanitizeTree } from '../src/svg.js';
import { parseXml } from '../src/xml.js';
import { createDocument, createElement, elementType } from '../src/model.js';
import { templatePath } from '../src/templates.js';
import { pointsToPath } from '../src/geometry.js';

function sampleDoc() {
  return createDocument({
    width: 640,
    height: 480,
    background: '#fdf6e3',
    elements: [
      createElement({ kind: 'stroke', d: pointsToPath([[10, 10], [50, 80], [120, 40]]), color: '#d62839', width: 6 }),
      createElement({
        kind: 'template', template: 'teardrop', d: templatePath('teardrop'), color: '#3a86ff', width: 4,
        x: 300, y: 200, rotation: 33.5, sx: 1.5, sy: 0.75,
      }),
      createElement({ kind: 'template', template: 'v-scroll', d: templatePath('v-scroll'), color: '#9bc53d', width: 2, paper: false, x: 100, y: 300 }),
    ],
  });
}

test('export produces SVG 1.1 with size, viewBox, background and no editor UI', () => {
  const svg = exportSvg(sampleDoc());
  const root = parseXml(svg);
  assert.equal(root.name, 'svg');
  assert.equal(root.attrs.xmlns, 'http://www.w3.org/2000/svg');
  assert.equal(root.attrs.version, '1.1');
  assert.equal(root.attrs.width, '640');
  assert.equal(root.attrs.height, '480');
  assert.equal(root.attrs.viewBox, '0 0 640 480');
  assert.match(svg, /fill="#fdf6e3"/);
  assert.doesNotMatch(svg, /handle|selection|grid/i);
  const groups = root.children.filter((c) => c.name === 'g');
  assert.equal(groups.length, 3, 'all elements in z-order');
  assert.equal(groups[1].attrs['quill:type'], 'template:teardrop');
  assert.equal(groups[0].attrs['quill:type'], 'stroke');
  assert.match(groups[1].attrs.transform, /rotate\(33.5\) scale\(1.5 0.75\)/);
});

test('round trip export -> import -> export is lossless', () => {
  const doc = sampleDoc();
  const first = exportSvg(doc);
  const { doc: imported, native } = importSvg(first);
  assert.equal(native, true);
  assert.equal(imported.width, 640);
  assert.equal(imported.height, 480);
  assert.equal(imported.background, '#fdf6e3');
  assert.deepEqual(imported.elements.map(elementType), ['stroke', 'template:teardrop', 'template:v-scroll']);
  for (const [i, el] of imported.elements.entries()) {
    const orig = doc.elements[i];
    for (const k of ['id', 'd', 'color', 'width', 'paper', 'x', 'y', 'rotation', 'sx', 'sy']) {
      assert.deepEqual(el[k], orig[k], `${k} of element ${i}`);
    }
  }
  assert.equal(exportSvg(imported), first);
});

test('generic SVG shapes become editable path elements', () => {
  const { doc, native, skipped } = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="200" height="100">
    <rect width="100%" height="100%" fill="navy"/>
    <g fill="red" transform="translate(10 0)">
      <circle cx="10" cy="10" r="5"/>
      <rect x="20" y="0" width="10" height="5" rx="2" style="fill:#00ff00;stroke:blue;stroke-width:2"/>
    </g>
    <line x1="0" y1="0" x2="10" y2="10" stroke="black"/>
    <polygon points="0,0 10,0 5,5" fill="none" stroke="rgb(255, 0, 0)"/>
    <ellipse cx="50" cy="25" rx="10" ry="5"/>
    <path d="M0 0 L 10"/>
    <text>ignored</text>
    <defs><path id="x" d="M0 0L1 1"/></defs>
  </svg>`);
  assert.equal(native, false);
  assert.equal(doc.width, 200);
  assert.equal(doc.background, '#000080');
  assert.equal(doc.elements.length, 5);
  assert.equal(skipped, 1, 'broken path is skipped');
  const [circle, rect, line, poly, ellipse] = doc.elements;
  assert.equal(circle.fill, '#ff0000');
  assert.deepEqual(circle.base, [2, 0, 0, 2, 20, 0], 'viewBox scale and group transform are kept');
  assert.equal(rect.fill, '#00ff00');
  assert.equal(rect.color, '#0000ff');
  assert.equal(rect.width, 2);
  assert.equal(line.fill, 'none');
  assert.equal(poly.color, '#ff0000');
  assert.equal(ellipse.fill, '#000000');
  // Generic elements export and re-import as well.
  const again = importSvg(exportSvg(doc));
  assert.equal(again.doc.elements.length, 5);
  assert.deepEqual(again.doc.elements[0].base, circle.base);
});

test('invalid or non-SVG files raise ImportError', () => {
  for (const bad of ['', 'not xml at all', '<html><body/></html>', '<svg><g></svg>', '\u0000\u0001binary']) {
    assert.throws(() => importSvg(bad), ImportError, JSON.stringify(bad));
  }
});

test('sanitizes scripts, event handlers and external references', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><div/></foreignObject>
    <a xlink:href="javascript:alert(1)"><path d="M0 0L10 10" stroke="red" onclick="alert(2)"/></a>
    <image href="https://evil.example/x.png"/>
    <rect width="5" height="5" fill="url(https://evil.example/#p)" style="background:url(http://x)"/>
    <use href="#local"/>
  </svg>`;
  const root = parseXml(src);
  sanitizeTree(root);
  const dump = JSON.stringify(root);
  assert.doesNotMatch(dump, /script|alert|onload|onclick|foreignObject|evil|http:\/\/x/);
  assert.match(dump, /#local/, 'local references are kept');
  const { doc } = importSvg(src);
  assert.equal(doc.elements.length, 2);
  assert.doesNotMatch(exportSvg(doc), /alert|evil|script/);
});

test('import never fails on deeply nested or unknown content', () => {
  const nested = '<g>'.repeat(200) + '<path d="M0 0L1 1" stroke="red"/>' + '</g>'.repeat(200);
  const { doc } = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><unknown><x/></unknown>${nested}</svg>`);
  assert.equal(doc.width, 800);
  assert.equal(doc.elements.length, 0, 'depth limit reached safely');
});
