// Inline SVG icons (24x24, stroke based). Inserted into elements with data-icon="name".
const P = {
  select: '<path d="M5 3l14 8-6.5 1.5L9.5 19z"/>',
  draw: '<path d="M4 20c2-1 3.5-4 6-4s2 3 4.5 3S19 15 20 13"/><path d="M14.5 4.5l5 5L12 17H7v-5z"/>',
  eraser: '<path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z"/><path d="M9 11l5 5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  forward: '<rect x="9" y="3" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M15 15v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1h5"/>',
  backward: '<rect x="3" y="9" width="12" height="12" rx="1.5"/><path d="M9 9V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4" stroke-dasharray="2 2"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  new: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  shapes: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a3 3 0 1 0-6 0a5 5 0 1 0 10 0a7 7 0 1 0-14 0"/>',
  style: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/><path d="M12 20.5c-1.5 0-2-1.5-1-2.5s0-3 2-3h3"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  flipH: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 6L3 18h6z"/><path d="M15 6l6 12h-6z" fill="currentColor" fill-opacity=".25"/>',
  flipV: '<path d="M3 12h18" stroke-dasharray="2 2.5"/><path d="M6 9L18 3v6z"/><path d="M6 15l12 6v-6z" fill="currentColor" fill-opacity=".25"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  selectAll: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" fill-opacity=".25"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
};

export function installIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const body = P[el.dataset.icon];
    if (!body) continue;
    el.insertAdjacentHTML(
      'afterbegin',
      `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
    );
  }
}
