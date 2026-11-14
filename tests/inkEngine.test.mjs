import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplePencilInkEngine, engineStrokeToZero, zeroStrokeToEngine} from '../dist/modules/inkEngine.js';

function fakeCanvas(w = 900, h = 1200) {
  const ctx = {
    calls: [],
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    save() {}, restore() {},
    beginPath() { this.calls.push('begin'); },
    moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    stroke() { this.calls.push('stroke'); },
    arc() { this.calls.push('arc'); },
    fill() { this.calls.push('fill'); },
    clearRect() { this.calls.push('clear'); },
    setTransform() {},
  };
  return {
    width: w, height: h, style: {}, ctx,
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect() { return {left: 0, top: 0, width: w, height: h}; },
    getContext() { return ctx; },
  };
}

let clock = 1000;
function pointer(over = {}) {
  const e = {
    pointerType: 'pen', pointerId: 1, clientX: 100, clientY: 100,
    pressure: 0.5, buttons: 1, timeStamp: (clock += 16),
    preventDefault() {}, ...over,
  };
  e.getCoalescedEvents = () => [e];
  e.getPredictedEvents = () => [];
  return e;
}

function makeEngine(opts = {}) {
  const strokes = [];
  const pans = [];
  const engine = new ApplePencilInkEngine({
    staticCanvas: fakeCanvas(),
    activeCanvas: fakeCanvas(),
    onStrokeComplete: (s) => strokes.push(s),
    onTwoFingerPanZoom: (p) => pans.push(p),
    ...opts,
  });
  return {engine, strokes, pans};
}

test('the canvas rect is read once per stroke, not once per sample', () => {
  let rectReads = 0;
  const canvas = fakeCanvas();
  const orig = canvas.getBoundingClientRect.bind(canvas);
  canvas.getBoundingClientRect = () => { rectReads++; return orig(); };
  const {engine, strokes} = makeEngine({staticCanvas: fakeCanvas(), activeCanvas: canvas});
  engine.handlePointerDown(pointer({clientX: 100, clientY: 100}));
  assert.equal(rectReads, 1);
  for (let i = 0; i < 5; i++) engine.handlePointerMove(pointer({clientX: 100 + i * 10, clientY: 100, buttons: 1}));
  assert.equal(rectReads, 1);
  engine.handlePointerUp(pointer({clientX: 150, clientY: 100, buttons: 0}));
  assert.equal(strokes.length, 1);
  // A new stroke re-reads the rect once.
  engine.handlePointerDown(pointer({clientX: 200, clientY: 200}));
  assert.equal(rectReads, 2);
});

test('stroke conversion round-trips through canvas space at any zoom', () => {
  const zero = {tool: 'pen', color: '#eee8db', width: 3, points: [[100, 200, 0.5], [300, 400, 1]]};
  for (const zoom of [0.5, 1, 2]) {
    assert.deepEqual(engineStrokeToZero(zeroStrokeToEngine(zero, zoom), zoom), zero);
  }
  const hi = {tool: 'highlighter', color: '#c4aa79', width: 2, points: [[0, 0, 0.2]]};
  assert.deepEqual(engineStrokeToZero(zeroStrokeToEngine(hi, 1.5), 1.5), hi);
});

test('eraser strokes never convert to a storable stroke', () => {
  const stroke = {tool: 'eraser', color: '#000000', baseWidth: 10, points: [{x: 10, y: 10, pressure: 0.5, t: 0}]};
  assert.equal(engineStrokeToZero(stroke, 1), null);
});

test('pen stroke commits with filtered points in canvas space', () => {
  const {engine, strokes} = makeEngine();
  engine.handlePointerDown(pointer());
  engine.handlePointerMove(pointer({clientX: 200, clientY: 100, pressure: 0.8}));
  engine.handlePointerUp(pointer({clientX: 200, clientY: 100, buttons: 0}));
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].tool, 'pen');
  assert.ok(strokes[0].points.length >= 2);
  assert.deepEqual([strokes[0].points[0].x, strokes[0].points[0].y], [100, 100]);
  assert.equal(engine.activePenId, null);
});

test('single-finger touch is ignored in Pencil-only mode', () => {
  const {engine, strokes, pans} = makeEngine({allowTouchDraw: false});
  engine.handlePointerDown(pointer({pointerType: 'touch', pointerId: 9, clientX: 50, clientY: 50}));
  engine.handlePointerMove(pointer({pointerType: 'touch', pointerId: 9, clientX: 150, clientY: 50}));
  engine.handlePointerUp(pointer({pointerType: 'touch', pointerId: 9, buttons: 0}));
  assert.equal(strokes.length, 0);
  assert.equal(pans.length, 0);
  assert.equal(engine.activePenId, null);
});

test('single-finger touch draws when Pencil-only is off', () => {
  const {engine, strokes} = makeEngine({allowTouchDraw: true});
  engine.handlePointerDown(pointer({pointerType: 'touch', pointerId: 9, clientX: 50, clientY: 50}));
  engine.handlePointerMove(pointer({pointerType: 'touch', pointerId: 9, clientX: 150, clientY: 50}));
  engine.handlePointerUp(pointer({pointerType: 'touch', pointerId: 9, buttons: 0}));
  assert.equal(strokes.length, 1);
  assert.ok(strokes[0].points.length >= 2);
});

test('a second finger cancels a touch stroke and starts pan/zoom', () => {
  const {engine, strokes, pans} = makeEngine({allowTouchDraw: true});
  engine.handlePointerDown(pointer({pointerType: 'touch', pointerId: 9, clientX: 100, clientY: 100}));
  engine.handlePointerMove(pointer({pointerType: 'touch', pointerId: 9, clientX: 120, clientY: 100}));
  engine.handlePointerDown(pointer({pointerType: 'touch', pointerId: 10, clientX: 200, clientY: 100}));
  engine.handlePointerMove(pointer({pointerType: 'touch', pointerId: 9, clientX: 130, clientY: 110}));
  engine.handlePointerUp(pointer({pointerType: 'touch', pointerId: 9, buttons: 0}));
  engine.handlePointerUp(pointer({pointerType: 'touch', pointerId: 10, buttons: 0}));
  assert.equal(strokes.length, 0);
  assert.equal(pans.length, 1);
  assert.equal(pans[0].dx, 5);
  assert.equal(pans[0].dy, 5);
  assert.ok(pans[0].scaleRatio < 1); // fingers moved closer together
});

test('mouse draws only when the app opts in', () => {
  const off = makeEngine({allowMouse: false});
  off.engine.handlePointerDown(pointer({pointerType: 'mouse', pointerId: 5}));
  off.engine.handlePointerUp(pointer({pointerType: 'mouse', pointerId: 5, buttons: 0}));
  assert.equal(off.strokes.length, 0);

  const on = makeEngine({allowMouse: true});
  on.engine.handlePointerDown(pointer({pointerType: 'mouse', pointerId: 5}));
  on.engine.handlePointerUp(pointer({pointerType: 'mouse', pointerId: 5, buttons: 0}));
  assert.equal(on.strokes.length, 1);
});

test('saved strokes re-render through drawStrokeToContext, eraser included', () => {
  const {engine} = makeEngine();
  const ctx = engine.staticCtx;
  engine.drawStrokeToContext(ctx, zeroStrokeToEngine(
    {tool: 'pen', color: '#eee8db', width: 3, points: [[10, 10, 0.5], [100, 10, 0.5], [200, 10, 0.5]]}, 1));
  assert.ok(ctx.calls.includes('stroke'));
  engine.drawStrokeToContext(ctx, {tool: 'eraser', color: '#000000', baseWidth: 10,
    points: [{x: 10, y: 10, pressure: 0.5, t: 0}, {x: 100, y: 10, pressure: 0.5, t: 0}]});
  assert.equal(ctx.globalCompositeOperation, 'destination-out');
});
