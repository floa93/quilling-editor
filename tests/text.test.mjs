import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, displayLines, textNodes, DEFAULT_TEXT, MAX_FONT_SIZE } from '../src/text.js';
import { createDocument, createElement, elementType, localBox, worldBox } from '../src/model.js';
import { exportSvg, importSvg } from '../src/svg.js';
import { serializeDocument, deserializeDocument } from '../src/storage.js';
import { parseXml } from '../src/xml.js';

const textEl = (text = {}, extra = {}) =>
  createElement({ kind: 'text', text: { ...DEFAULT_TEXT, ...text }, color: '#3a86ff', width: 4, x: 200, y: 150, ...extra });

test('normalizeText fills defaults and clamps values', () => {
  assert.deepEqual(normalizeText(), DEFAULT_TEXT);
  const t = normalizeText({ content: 'a\r\nb', font: 'nope', size: 99999, grow: -3, case: 'shout', bold: false, italic: true });
  assert.equal(t.content, 'a\nb');
  assert.equal(t.font, DEFAULT_TEXT.font);
  assert.equal(t.size, MAX_FONT_SIZE);
  assert.equal(t.grow, 0);
  assert.equal(t.case, 'none');
  assert.equal(t.bold, false);
  assert.equal(t.italic, true);
});

test('case is applied when displaying, lines are split', () => {
  assert.deepEqual(displayLines(normalizeText({ content: 'Hello\nWorld', case: 'upper' })), ['HELLO', 'WORLD']);
  assert.deepEqual(displayLines(normalizeText({ content: 'Hello', case: 'lower' })), ['hello']);
  assert.deepEqual(displayLines(normalizeText({ content: 'Hello', case: 'none' })), ['Hello']);
});

test('text elements get a bounding box, no paper look and no fill', () => {
  const el = textEl({ content: 'AB' }, { paper: true, fill: '#ff0000' });
  assert.equal(elementType(el), 'text');
  assert.equal(el.paper, false);
  assert.equal(el.fill, 'none');
  const b = localBox(el);
  assert.ok(b.width > 0 && b.height > 0);
  // Centered on the requested position.
  const w = worldBox(el);
  assert.ok(Math.abs(w.x + w.width / 2 - 200) < 1e-6 && Math.abs(w.y + w.height / 2 - 150) < 1e-6);
});

test('outline is a ring: grown glyphs masked by the inner glyph shape', () => {
  const el = textEl({ content: 'O', grow: 10 });
  const [defs, outline] = textNodes(el, 'm1', localBox(el));
  const mask = defs.children[0];
  assert.equal(mask.attrs.id, 'm1');
  assert.equal(outline.attrs.mask, 'url(#m1)');
  assert.equal(outline.attrs['stroke-width'], String(2 * (10 + 4)));
  const hole = mask.children[1];
  assert.equal(hole.attrs['stroke-width'], '20');
  assert.equal(hole.attrs.fill, '#000000');
  assert.equal(outline.children[0].text, 'O');
});

test('font styles map to SVG attributes', () => {
  const el = textEl({ font: 'serif', bold: false, italic: true, spacing: 0 });
  const [, outline] = textNodes(el, 'm', localBox(el));
  assert.match(outline.attrs['font-family'], /Georgia/);
  assert.equal(outline.attrs['font-weight'], '400');
  assert.equal(outline.attrs['font-style'], 'italic');
  // The spacing is the gap between outlines: grown outline (8 + 4 on each side) is added.
  assert.equal(outline.attrs['letter-spacing'], '24');
});

test('negative spacing can cancel the outline allowance', () => {
  const el = textEl({ spacing: -24 });
  const [, outline] = textNodes(el, 'm', localBox(el));
  assert.equal(outline.attrs['letter-spacing'], undefined);
});

test('SVG export -> import round trip keeps text elements', () => {
  const doc = createDocument({
    elements: [textEl({ content: 'Tom & "Jerry"\n<3', font: 'script', size: 120, bold: false, italic: true, case: 'upper', grow: 12, spacing: 30 }, { rotation: 15, sx: 1.5 })],
  });
  const svg = exportSvg(doc);
  parseXml(svg); // well-formed
  assert.match(svg, /<mask id="qmask-/);
  assert.match(svg, /TOM &amp; &quot;JERRY&quot;/);
  const { doc: imported, native } = importSvg(svg);
  assert.equal(native, true);
  const [a, b] = [doc.elements[0], imported.elements[0]];
  for (const k of ['id', 'kind', 'd', 'color', 'width', 'x', 'y', 'rotation', 'sx', 'sy', 'text']) {
    assert.deepEqual(b[k], a[k], k);
  }
  assert.equal(exportSvg(imported), svg);
});

test('auto-save keeps text elements', () => {
  const doc = createDocument({ elements: [textEl({ content: 'Hi' })] });
  const restored = deserializeDocument(serializeDocument(doc));
  assert.deepEqual(restored.elements[0].text, doc.elements[0].text);
  assert.equal(restored.elements[0].d, doc.elements[0].d);
});
