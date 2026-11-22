import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, XmlError, escapeXml, decodeEntities } from '../src/xml.js';

test('parses elements, attributes, text, comments, CDATA and doctype', () => {
  const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [ <!ENTITY x "boom"> ]>
<!-- comment -->
<svg a='1' b="&lt;&amp;&#65;&#x42;&x;"><g><![CDATA[raw <text>]]></g><path d="M0 0"/></svg>`);
  assert.equal(root.name, 'svg');
  assert.equal(root.attrs.a, '1');
  assert.equal(root.attrs.b, '<&AB', 'custom entities are not expanded');
  assert.equal(root.children[0].children[0].value, 'raw <text>');
  assert.equal(root.children[1].name, 'path');
});

test('rejects malformed XML', () => {
  for (const bad of ['', 'hello', '<svg>', '<svg></g>', '<svg a=1></svg>', '<svg a="1" a="2"/>', '<a/><b/>']) {
    assert.throws(() => parseXml(bad), XmlError, bad);
  }
});

test('escape/decode round trip', () => {
  const s = `a<b>&"c'`;
  assert.equal(decodeEntities(escapeXml(s)), s);
});
