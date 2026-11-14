import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
const engineSrc = readFileSync(new URL('../dist/modules/inkEngine.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

// Audit: ApplePencilInkEngine is the sole drawing pipeline. No other file
// in the app may listen for drawing or touch input on the canvas.
const LEGACY_DRAW = /pointerdown|pointermove|pointerup|pointercancel|touchstart|touchmove|touchend|mousedown|mousemove|mouseup/;

test('no legacy drawing or touch handlers anywhere except the engine', () => {
  for (const f of readdirSync(new URL('../dist/modules', import.meta.url))) {
    if (f === 'inkEngine.js') continue;
    const src = readFileSync(new URL(`../dist/modules/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, LEGACY_DRAW, `${f} must not listen for drawing input`);
  }
  assert.doesNotMatch(app, LEGACY_DRAW, 'app.js must not listen for drawing input');
  assert.doesNotMatch(html, LEGACY_DRAW, 'index.html must not listen for drawing input');
  assert.match(engineSrc, /addEventListener\('pointerdown'/, 'the engine owns pointerdown');
  assert.equal((app.match(/new ApplePencilInkEngine/g) || []).length, 1, 'exactly one engine instance');
});

test('canvas layering: static below, active on top, identical CSS size', () => {
  assert.match(css, /#ink-static\{[^}]*position:absolute;inset:0;width:100%;height:100%;pointer-events:none/, 'static canvas is inert');
  assert.match(css, /#ink\{[^}]*position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;z-index:10/, 'active canvas is on top and receives input');
  assert.match(css, /\.paper\{[^}]*position:relative/, 'the paper is the relative stacking container');
  assert.match(app, /<canvas id="ink-static"[^>]*><\/canvas><canvas id="ink"/, 'static canvas is emitted below the active canvas');
});

test('sizing happens only on mount and real resize, never on stroke commit', () => {
  // Assigning canvas.width wipes the bitmap, so the backing size may
  // only be assigned in sizeInkCanvas, guarded by an actual size change.
  // (The `===` guard in sizeInkCanvas is a comparison, not an assignment.)
  assert.equal((app.match(/canvas\.width=(?!=)/g) || []).length, 1, 'canvas.width is assigned only in sizeInkCanvas');
  assert.equal((app.match(/canvas\.height=(?!=)/g) || []).length, 1, 'canvas.height is assigned only in sizeInkCanvas');
  assert.match(app, /function sizeInkCanvas\(canvas\)\{[^}]*if\(canvas\.width===w&&canvas\.height===h\)return;/, 'sizing is skipped when the size did not change');
  assert.match(app, /new ResizeObserver\(\(\)=>requestPaperResize\(\)\)/, 'a ResizeObserver watches the paper container');
  const resize = app.slice(app.indexOf('function requestPaperResize()'), app.indexOf('function maybeApplyPendingResize()'));
  assert.match(resize, /redrawStatic\(\)/, 'a resize replays the saved strokes');
  const commit = app.slice(app.indexOf('function handleStrokeComplete'), app.indexOf('function handlePanZoom'));
  assert.doesNotMatch(commit, /sizeInkCanvas|canvas\.width\s*=|canvas\.height\s*=/, 'stroke commit never resizes a canvas');
  assert.match(commit, /redrawStatic\(\)/, 'stroke commit only replays saved strokes');
});

test('the document root kills the iPadOS touch delay without killing scroll', () => {
  for (const sel of ['html', 'body', '#app']) {
    assert.match(css, new RegExp(`${sel}\\{[^}]*overscroll-behavior:none`), `${sel} never rubber-bands`);
    assert.match(css, new RegExp(`${sel}\\{[^}]*-webkit-touch-callout:none`), `${sel} never shows a callout`);
  }
  // touch-action:none lives on the ink surface only; the body keeps
  // `manipulation` (no double-tap delay) so the library still scrolls.
  assert.match(css, /\.paper\{[^}]*touch-action:none/, 'the paper container never delays a Pencil touch');
  assert.match(css, /#ink\{[^}]*touch-action:none/, 'the active canvas never delays a Pencil touch');
  assert.match(css, /body\{[^}]*touch-action:manipulation/, 'the body keeps native scrolling');
  assert.match(css, /input,textarea,select\{user-select:text/, 'editable text stays selectable');
});

test('Pencil-only isolation and live tool updates need no re-initialization', () => {
  assert.match(engineSrc, /allowTouchDraw/, 'the engine gates single-finger drawing');
  assert.match(app, /engine\.allowTouchDraw=!e\.target\.checked/, 'the Pencil-only switch flips the engine live');
  assert.match(app, /function syncEngine\(\)\{[^}]*engine\.tool=tool;engine\.color=inkColor;engine\.baseWidth=width\*zoom;/, 'tool, color and width update live');
  const setTool = app.slice(app.indexOf('function setTool(t)'), app.indexOf('function applyZoom'));
  assert.match(setTool, /syncEngine\(\)/, 'choosing a tool syncs the engine');
});
