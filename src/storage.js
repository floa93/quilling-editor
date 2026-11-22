// Auto-save to localStorage. Every access is guarded: when storage is unavailable
// (private mode, disabled cookies, quota exceeded) the editor keeps working without it.
import { createDocument, createElement, clamp, normalizeColor, MIN_CANVAS, MAX_CANVAS } from './model.js';
import { templatePath, TEMPLATE_IDS } from './templates.js';

export const STORAGE_KEY = 'quilling-editor:document:v1';

function getStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__quilling_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Serializes a document compactly: template paths are regenerated on load. */
export function serializeDocument(doc) {
  return JSON.stringify({
    width: doc.width,
    height: doc.height,
    background: doc.background,
    elements: doc.elements.map((el) =>
      el.kind === 'template' && el.d === templatePath(el.template) ? { ...el, d: undefined } : el,
    ),
  });
}

export function deserializeDocument(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.elements)) throw new Error('Invalid saved document');
  const elements = [];
  for (const raw of data.elements) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw.d ?? (raw.kind === 'template' && TEMPLATE_IDS.includes(raw.template) ? templatePath(raw.template) : null);
    if (typeof d !== 'string') continue;
    elements.push(createElement({ ...raw, d }));
  }
  return createDocument({
    width: clamp(Number(data.width) || 800, MIN_CANVAS, MAX_CANVAS),
    height: clamp(Number(data.height) || 800, MIN_CANVAS, MAX_CANVAS),
    background: normalizeColor(data.background, '#ffffff'),
    elements,
  });
}

export class AutoSave {
  constructor(delay = 400) {
    this.storage = getStorage();
    this.delay = delay;
    this.timer = null;
    this.pending = null;
  }

  get available() {
    return Boolean(this.storage);
  }

  load() {
    if (!this.storage) return null;
    try {
      const json = this.storage.getItem(STORAGE_KEY);
      return json ? deserializeDocument(json) : null;
    } catch (e) {
      console.warn('Could not restore the saved design:', e);
      return null;
    }
  }

  schedule(doc) {
    if (!this.storage) return;
    this.pending = doc;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    if (!this.storage || !this.pending) return;
    try {
      this.storage.setItem(STORAGE_KEY, serializeDocument(this.pending));
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
    this.pending = null;
  }
}
