# Quilling Online Editor – Acceptance Criteria

## Overview

A browser-based editor for designing paper quilling artwork. The user starts with a blank canvas and can either draw paper strips freehand with the mouse or drag and drop predefined quilling shape templates onto the canvas. Designs can be exported to and imported from SVG. The app is a purely static site hosted on GitHub Pages — no backend, no database, no user accounts.

---

## 1. Hosting & Architecture

- **AC-1.1** The application is a static site (HTML/CSS/JS only) and runs fully client-side in the browser.
- **AC-1.2** No server, database, or external API is required for any feature.
- **AC-1.3** The site is deployed to GitHub Pages via a GitHub Actions workflow on every push to `main`.
- **AC-1.4** The deployed app works when served from the repository sub-path (e.g. `https://<user>.github.io/quilling-editor/`); all asset paths are relative or respect the configured base path.
- **AC-1.5** A failing build blocks deployment; the previously deployed version stays online.
- **AC-1.6** The app works in the current versions of Chrome, Firefox, Safari, and Edge on desktop, and in mobile Safari and Chrome on mobile devices.

## 2. Canvas

- **AC-2.1** On first load, the user sees an empty (blank) canvas ready for drawing.
- **AC-2.2** The canvas has a defined size (default e.g. 800×800 px) that the user can change; the canvas size is stored in the exported SVG (`width`, `height`, `viewBox`).
- **AC-2.3** The user can change the canvas background color (default: white).
- **AC-2.4** The user can zoom in/out (mouse wheel + buttons) and pan (e.g. space + drag or middle mouse button) without altering the drawing.
- **AC-2.5** A "Reset view" / "Fit to screen" action restores the default zoom and position.
- **AC-2.6** A "New / Clear canvas" action removes all elements after a confirmation prompt.

## 3. Freehand Drawing (Paint Mode)

- **AC-3.1** In draw mode, pressing and dragging the mouse on the canvas draws a continuous stroke that follows the pointer.
- **AC-3.2** Strokes are smoothed (no jagged polyline appearance) and stored as vector paths, not pixels.
- **AC-3.3** The user can select stroke color from a palette and a custom color picker.
- **AC-3.4** The user can set stroke width (representing paper strip width, e.g. 1–20 px).
- **AC-3.5** Strokes optionally render with a "paper strip" look (e.g. slight edge shading) that is also preserved in SVG export, or degrades gracefully to a solid stroke.
- **AC-3.6** An eraser tool removes an entire stroke/element when clicked or dragged over.
- **AC-3.7** Drawing works with touch/pen input as well as mouse (pointer events).

## 4. Shape Templates (Drag & Drop)

- **AC-4.1** A sidebar/palette shows a library of quilling shape templates with a preview thumbnail and name.
- **AC-4.2** The library contains at least these basic quilling shapes:
  - Tight coil
  - Loose coil
  - Teardrop
  - Marquise (eye)
  - Square
  - Triangle
  - Half moon
  - Heart
  - Leaf / bent marquise
  - S-scroll
  - C-scroll
  - V-scroll
- **AC-4.3** Templates are rendered as coil/spiral paths that resemble rolled paper strips (not just filled outlines).
- **AC-4.4** The user can drag a template from the palette and drop it onto the canvas; it is placed at the drop position.
- **AC-4.5** Dropped shapes use the currently selected color and strip width.
- **AC-4.6** Dropping outside the canvas does not create an element.

## 5. Selecting & Editing Elements

- **AC-5.1** In select mode, clicking an element (stroke or shape) selects it and shows a bounding box with handles.
- **AC-5.2** Selected elements can be moved by dragging.
- **AC-5.3** Selected elements can be scaled via corner handles (shift keeps aspect ratio) and rotated via a rotation handle.
- **AC-5.4** The color and strip width of a selected element can be changed afterwards.
- **AC-5.5** Multiple elements can be selected (shift+click and/or rubber-band selection) and moved/deleted together.
- **AC-5.6** Selected elements can be deleted with `Delete`/`Backspace` or a toolbar button.
- **AC-5.7** Selected elements can be duplicated (`Ctrl/Cmd + D` or copy/paste).
- **AC-5.8** Elements can be brought forward/sent backward (z-order).

## 6. Undo / Redo

- **AC-6.1** Every change (draw, drop, move, scale, rotate, color change, delete, clear) can be undone with `Ctrl/Cmd + Z` and a toolbar button.
- **AC-6.2** Undone changes can be redone with `Ctrl/Cmd + Shift + Z` / `Ctrl + Y` and a toolbar button.
- **AC-6.3** At least 50 undo steps are supported.

## 7. SVG Export

- **AC-7.1** An "Export SVG" button downloads the current design as a `.svg` file (default name e.g. `quilling-design.svg`).
- **AC-7.2** The exported file is valid SVG 1.1 and opens correctly in common viewers (browser, Inkscape, Illustrator).
- **AC-7.3** The export includes all elements, their colors, strip widths, transforms, z-order, canvas size, and background.
- **AC-7.4** The export does not include editor UI (selection boxes, handles, grid).
- **AC-7.5** The SVG embeds editor metadata (e.g. `data-*` attributes or a `<metadata>` block identifying element type such as `stroke` or `template:teardrop`) so it can be re-imported losslessly.

## 8. SVG Import

- **AC-8.1** An "Import SVG" button opens a file picker accepting `.svg` files; drag-and-drop of an `.svg` file onto the canvas also works.
- **AC-8.2** Importing an SVG previously exported by the editor restores the design exactly: every element is again individually selectable and editable with its original type, color, width, and position (round-trip export → import → export yields an equivalent file).
- **AC-8.3** Importing a generic third-party SVG displays its paths/shapes on the canvas as editable elements as far as supported; unsupported content is ignored without crashing.
- **AC-8.4** Before importing, the user is asked whether to replace the current design or add the imported content to it.
- **AC-8.5** Invalid or non-SVG files show a clear error message and leave the current canvas unchanged.
- **AC-8.6** Imported SVG content is sanitized (scripts, event handler attributes, and external references are stripped) before rendering.

## 9. Local Persistence (no database)

- **AC-9.1** The current design is auto-saved to the browser's `localStorage` and restored on page reload.
- **AC-9.2** If `localStorage` is unavailable, the editor still works (without auto-save).

## 10. Usability

- **AC-10.1** A toolbar clearly shows the active tool (Select, Draw, Eraser) and allows switching via click and keyboard shortcuts (e.g. `V`, `B`, `E`).
- **AC-10.2** The UI is in a consistent language and all tools have tooltips.
- **AC-10.3** The layout is responsive and fully usable from 360 px (phone) up to large desktop screens (see section 11 for mobile).
- **AC-10.4** Interactions feel responsive: drawing and dragging run at a smooth frame rate with at least 500 elements on the canvas.

## 11. Mobile UX/UI

- **AC-11.1** The app works in current mobile Safari (iOS) and Chrome (Android) on phones and tablets, in both portrait and landscape.
- **AC-11.2** On phones, the canvas takes up most of the screen. Tools sit in a compact bottom toolbar within thumb reach, and the template library and properties (color, width) open as bottom sheets or drawers that can be dismissed.
- **AC-11.3** All touch targets are at least 44×44 px, with enough spacing to avoid mis-taps.
- **AC-11.4** Touch gestures:
  - One finger draws in draw mode and moves elements in select mode.
  - Two-finger pinch zooms and two-finger drag pans the canvas in any mode, without leaving a stray stroke.
  - Pinch/rotate with two fingers on a selected element scales/rotates it.
- **AC-11.5** Browser default gestures (page scroll, pull-to-refresh, double-tap zoom, text selection, long-press context menu) are disabled on the canvas, while the rest of the page stays accessible.
- **AC-11.6** Templates can be added on touch devices either by dragging from the bottom sheet onto the canvas or by tapping a template, which places it in the center of the visible canvas area.
- **AC-11.7** Selection handles are enlarged on touch devices so they can be grabbed reliably with a finger.
- **AC-11.8** Pen/stylus input (e.g. Apple Pencil) draws with palm rejection: while a pen is active, touches from the hand do not draw.
- **AC-11.9** Actions that rely on keyboard shortcuts on desktop (undo, redo, delete, duplicate, layer order) are reachable through visible buttons or menus on mobile.
- **AC-11.10** SVG export saves or shares the file on mobile (download, or the native share sheet where supported), and import works via the native file picker.
- **AC-11.11** The layout respects device safe areas (notch, home indicator) and does not break when the on-screen keyboard opens (e.g. when entering a hex color).
- **AC-11.12** Drawing on a mid-range phone feels smooth (target 60 fps, no visible lag between finger and stroke).
- **AC-11.13** The app can be added to the home screen (web app manifest and icons) and opens in full-screen/standalone mode.

## 12. Quality

- **AC-12.1** Core logic (SVG serialization/parsing, template generation, undo/redo) is covered by automated tests that run in the GitHub Actions workflow before deployment.
- **AC-12.2** A `README.md` describes how to run the editor locally, build it, and how deployment works.

---

## Out of Scope

- User accounts, cloud storage, or sharing via server
- Real-time collaboration
- Raster export (PNG/JPG) — may be added later
- Printing / strip-length calculation for physical crafting — may be added later
