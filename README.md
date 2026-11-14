# Zero

An independent, black-canvas notebook application. Name: **Zero**. No relationship to or dependency on Synarc.

## Included

- Notebooks with champagne, sage, silver, rose, and lavender cover accents.
- Collections, favorites, sort, and search across notebook/page names and typed text.
- Multiple named pages per notebook; duplicate, reorder, and delete pages.
- Pressure-aware vector ink, highlighter, whole-stroke eraser, color and width controls.
- Per-page session ink undo/redo, mixed typed text and handwriting, four paper templates.
- Zoom, fit-to-width, focus mode, page previews, responsive phone/tablet/desktop layouts.
- IndexedDB autosave, explicit storage failures, optimistic concurrency protection against overwriting newer saves from another tab.
- JSON workspace export and validated, non-destructive import; PNG page export and browser Print/PDF for a notebook.
- Installable web manifest and service worker for the cached app shell.

No analytics, accounts, remote fonts, external libraries, or subscription dependencies. No cloud sync. Data lives in the browser, not in the GitHub repository or the static hosting service. Clearing website data can remove notes; keep backups.

## Apple Pencil / iPad

Open the HTTPS app in Safari on a compatible iPad. Apple Pencil is handled by `dist/modules/inkEngine.js` (`ApplePencilInkEngine`) through Pointer Events, with a OneEuro filter smoothing the stroke and coalesced + predicted samples for low-latency wet ink. Browser-supplied pressure changes pen width. With **Pencil only** enabled, a single finger is ignored, so a palm rest makes no marks; two fingers pan and pinch-zoom the page. With Pencil only off, a finger can draw (the only way to draw on a phone). Mouse input remains available. Choose Text to use the keyboard or iPad Scribble in the textarea. Use Safari's Share → Add to Home Screen for a standalone launch where supported.

This is a web app, not a PencilKit native app. Pencil Pro squeeze, barrel roll, double-tap, hover previews, haptics, and OS-grade palm rejection are not implemented. Real Pencil latency, pressure, touch interaction, and Safari behavior still require device QA. Text occupies a fixed page area; overflow is rejected with a prompt to add another page. Search does not recognize handwriting. Ink history is session-local and clears on reload.

## Development

Zero build dependencies. Serve `dist/` over HTTP for local development. For example, `python3 -m http.server 8080 --directory dist`. Use HTTPS for deployment. Do not open `index.html` via `file://` because modules and browser storage require an appropriate origin.

- `npm run check`: syntax checks.
- `npm test`: backup safety, migration isolation, eraser geometry, and pointer handling tests.

## GitHub Pages

The included `.github/workflows/pages.yml` tests and publishes `dist/` when `main` changes. Enable **Settings → Pages → Source: GitHub Actions** in the target repository first. Pages availability for private repositories depends on the GitHub plan. The workflow requires permission to deploy Pages. Repository publishing is a separate step from the private hosted preview.

All app assets use relative URLs, so both project paths and custom-domain roots work. Update the service-worker cache version whenever changing the app shell. Confirm any workflow action-version updates against GitHub's documentation before upgrading.

The IndexedDB database retains its original internal identifier (`atelier-notes-v1`) so the rename does not erase existing notes.

## Integration into Synarc later

`dist/modules/model.js` owns the versioned data schema, IDs, cloning, import validation, and merge behavior. `inkEngine.js` owns Apple Pencil pointer handling, wet-ink rendering, and two-finger pan/zoom; `ink.js` owns the fixed 900×1200 document-space rendering used for page thumbnails and PNG export, plus whole-stroke eraser hit-testing. Strokes are stored in document space and converted to/from the engine's canvas CSS-pixel space by zoom in `inkEngine.js`. `storage.js` owns persistence and downloads. `app.js` is the interface and controller; `styles.css` is independent presentation.

To integrate, preserve the `version: 1` export contract, import the model and ink modules, and substitute a Synarc persistence adapter. Convert data with `mergedState()` to avoid identifier collisions. Coordinate and pressure data are portable JSON, not opaque canvas snapshots. Keep the original backups during migration; do not silently overwrite a user's workspace.

## Verification

Browser QA: notebook creation, text entry, ink drawing, save/reopen, undo/redo, adding and reordering pages, collection assignment, and full-text search. Visual QA at 390px phone, 820px tablet, and desktop widths. Automated model/geometry/pointer tests pass. Physical iPad/Pencil testing, cross-device sync, native Pencil Pro gestures, and app-store packaging are outside this first version.

## Ownership

This source was created for the owner of this project. No open-source license has been selected; choose a license before inviting public reuse.

## Version 1.1 improvements

- Full Zero branding and a zero-shaped app icon.
- Recently deleted keeps removed notebooks and pages recoverable, including their ink. Deleted items are included in JSON backups and imports.
- Notebooks remember the last page opened; the home screen offers a resume action.
- Search within the current notebook by page title or typed text.
- Edit an existing notebook's cover accent.
- Custom ink colors and remembered pen width, available on tablets and phones through Ink settings.
- P / H / E / T switches tools outside text fields and dialogs.
- Completed ink is cached while drawing, avoiding replay of every previous stroke for every pointer update.
- Import validation rejects unsafe identifiers and validates deleted data before merging.
- Apple Pencil ink engine (`inkEngine.js`): two stacked devicePixelRatio-scaled canvases (committed ink below, live wet ink above), ruled paper kept as a CSS background so the eraser can only erase ink, OneEuro-filtered Pencil strokes with predicted-point tip tracking, and two-finger pan/pinch-zoom. Saved strokes, undo/redo, and exports are unchanged — strokes are still stored in the 900×1200 document space.
- Pencil pipeline audit: `inkEngine.js` is now the sole drawing pipeline — the legacy `InkSurface` pointer/touch handlers were deleted from `ink.js`, canvases are re-sized only on mount and real container resize (via `ResizeObserver`, replaying saved strokes, never on stroke commit), the canvas rect is read once per stroke instead of once per sample, and the document root blocks rubber-banding and callouts without blocking scrolling.

25 automated tests pass. Browser QA covers delete/restore, restored text search, last-page resume controls, and ink undo/redo. Physical Apple Pencil testing remains necessary.
