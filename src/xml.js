// Minimal, strict XML parser and escaping helpers.
// Used for SVG import so that parsing behaves identically in the browser and in Node tests.
// It never evaluates anything: DTD/entity declarations are skipped and only the five
// predefined entities plus numeric character references are decoded.

export class XmlError extends Error {}

const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    return ENTITIES[e] ?? ''; // unknown (DTD-defined) entities are dropped, never expanded
  });
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parses an XML string into a tree of
 * {type:'element', name, attrs, children} and {type:'text', value} nodes.
 * Returns the root element. Throws XmlError on malformed input.
 */
export function parseXml(src) {
  if (typeof src !== 'string') throw new XmlError('Input is not text');
  let pos = 0;
  const len = src.length;
  const fail = (msg) => {
    throw new XmlError(`${msg} (at offset ${pos})`);
  };
  const readName = () => {
    NAME_RE.lastIndex = pos;
    const m = NAME_RE.exec(src);
    if (!m) fail('Expected a name');
    pos = NAME_RE.lastIndex;
    return m[0];
  };
  const skipWs = () => {
    while (pos < len && /\s/.test(src[pos])) pos++;
  };
  const skipUntil = (end, what) => {
    const i = src.indexOf(end, pos);
    if (i < 0) fail(`Unterminated ${what}`);
    pos = i + end.length;
  };

  const root = { type: 'element', name: '#document', attrs: {}, children: [] };
  const stack = [root];

  if (src.charCodeAt(0) === 0xfeff) pos = 1;

  while (pos < len) {
    const parent = stack[stack.length - 1];
    if (src[pos] !== '<') {
      const next = src.indexOf('<', pos);
      const end = next < 0 ? len : next;
      const raw = src.slice(pos, end);
      if (stack.length === 1) {
        if (raw.trim()) fail('Text outside the root element');
      } else parent.children.push({ type: 'text', value: decodeEntities(raw) });
      pos = end;
      continue;
    }
    if (src.startsWith('<!--', pos)) {
      pos += 4;
      skipUntil('-->', 'comment');
    } else if (src.startsWith('<![CDATA[', pos)) {
      const start = pos + 9;
      pos = start;
      skipUntil(']]>', 'CDATA section');
      if (stack.length === 1) fail('CDATA outside the root element');
      parent.children.push({ type: 'text', value: src.slice(start, pos - 3) });
    } else if (src.startsWith('<?', pos)) {
      pos += 2;
      skipUntil('?>', 'processing instruction');
    } else if (src.startsWith('<!DOCTYPE', pos) || src.startsWith('<!doctype', pos)) {
      // Skip the doctype including an internal subset; entity declarations are ignored.
      pos += 9;
      let depth = 0;
      while (pos < len) {
        const c = src[pos++];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
    } else if (src[pos + 1] === '/') {
      pos += 2;
      const name = readName();
      skipWs();
      if (src[pos] !== '>') fail('Expected >');
      pos++;
      if (stack.length === 1 || parent.name !== name) fail(`Unexpected closing tag </${name}>`);
      stack.pop();
    } else {
      pos++;
      const name = readName();
      const attrs = {};
      for (;;) {
        skipWs();
        if (src[pos] === '>' || src.startsWith('/>', pos)) break;
        if (pos >= len) fail('Unterminated tag');
        const attr = readName();
        skipWs();
        if (src[pos] !== '=') fail(`Expected = after attribute ${attr}`);
        pos++;
        skipWs();
        const q = src[pos];
        if (q !== '"' && q !== "'") fail('Expected quoted attribute value');
        const end = src.indexOf(q, pos + 1);
        if (end < 0) fail('Unterminated attribute value');
        const raw = src.slice(pos + 1, end);
        if (raw.includes('<')) fail('< is not allowed in attribute values');
        if (attr in attrs) fail(`Duplicate attribute ${attr}`);
        attrs[attr] = decodeEntities(raw);
        pos = end + 1;
      }
      const el = { type: 'element', name, attrs, children: [] };
      if (stack.length === 1 && root.children.some((c) => c.type === 'element')) fail('Multiple root elements');
      parent.children.push(el);
      if (src[pos] === '/') pos += 2;
      else {
        pos++;
        stack.push(el);
      }
    }
  }
  if (stack.length > 1) throw new XmlError(`Unclosed element <${stack[stack.length - 1].name}>`);
  const top = root.children.find((c) => c.type === 'element');
  if (!top) throw new XmlError('No root element');
  return top;
}

/** Local name without namespace prefix. */
export const localName = (name) => name.slice(name.indexOf(':') + 1);
