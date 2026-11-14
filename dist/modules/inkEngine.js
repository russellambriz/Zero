class OneEuroFilter {
  constructor(minCutoff = 1.6, beta = 0.015, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, tMs) {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    let dt = (tMs - this.tPrev) / 1000;
    if (dt <= 0.0001) dt = 1 / 240; // Guard duplicate coalesced timestamps
    if (dt > 0.1) dt = 1 / 60;

    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const filtered = this.xPrev + this.alpha(cutoff, dt) * (x - this.xPrev);

    this.xPrev = filtered;
    this.dxPrev = edx;
    this.tPrev = tMs;
    return filtered;
  }
}

export class ApplePencilInkEngine {
  constructor({ staticCanvas, activeCanvas, onStrokeComplete, onTwoFingerPanZoom, allowMouse = false, allowTouchDraw = false }) {
    this.staticCanvas = staticCanvas;
    this.activeCanvas = activeCanvas;
    this.staticCtx = staticCanvas.getContext('2d');
    this.activeCtx = activeCanvas.getContext('2d');

    this.onStrokeComplete = onStrokeComplete || (() => {});
    this.onTwoFingerPanZoom = onTwoFingerPanZoom || (() => {});
    // Zero addition: the pasted engine is pen-only. Zero also lets a mouse
    // draw, and lets a finger draw when "Pencil only" is off (the only way
    // to draw on a phone), so mouse input is treated like a pen only when
    // the app opts in, and single-finger drawing only when allowTouchDraw
    // is on. In Pencil-only mode a single finger is always ignored.
    this.allowMouse = allowMouse;
    this.allowTouchDraw = allowTouchDraw;

    // Tool state
    this.tool = 'pen'; // 'pen' | 'highlighter' | 'eraser'
    this.color = '#f5d76e';
    this.baseWidth = 2.6;

    // Input state
    this.activePenId = null;
    this.currentPoints = [];
    this.filterX = null;
    this.filterY = null;
    this.activeTouches = new Map();
    this.lastPinchMid = null;
    this.lastPinchDist = null;
    this.touchStrokeId = null;

    this.bindEvents();
  }

  isPenLike(e) {
    return e.pointerType === 'pen' || (e.pointerType === 'mouse' && this.allowMouse);
  }

  bindEvents() {
    const el = this.activeCanvas;

    // Lock down iPadOS Scribble, callouts, and native scroll hijacking
    Object.assign(el.style, {
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      webkitTouchCallout: 'none',
    });

    const preventNative = (e) => e.preventDefault();
    el.addEventListener('touchstart', preventNative, { passive: false });
    el.addEventListener('touchmove', preventNative, { passive: false });
    el.addEventListener('gesturestart', preventNative, { passive: false });

    el.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    el.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    el.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    el.addEventListener('pointercancel', (e) => this.handlePointerCancel(e));
    el.addEventListener('lostpointercapture', (e) => this.handlePointerCancel(e));
  }

  toCanvasCoords(e) {
    const rect = this.activeCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      t: e.timeStamp || performance.now(),
    };
  }

  startPenStroke(e) {
    this.activePenId = e.pointerId;
    try {
      this.activeCanvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    this.filterX = new OneEuroFilter(1.6, 0.015);
    this.filterY = new OneEuroFilter(1.6, 0.015);

    const raw = this.toCanvasCoords(e);
    const pt = {
      x: this.filterX.filter(raw.x, raw.t),
      y: this.filterY.filter(raw.y, raw.t),
      pressure: raw.pressure,
      t: raw.t,
    };
    this.currentPoints = [pt];
    this.renderWetStroke(this.currentPoints);
  }

  handlePointerDown(e) {
    if (this.isPenLike(e)) {
      e.preventDefault();
      if (this.activePenId !== null) this.commitPenStroke();
      this.startPenStroke(e);
      return;
    }

    // Track fingers strictly for 2-finger pan/zoom (ignore single-finger palm rest)
    if (e.pointerType === 'touch') {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2) {
        // A second finger means pan/zoom, not a stroke: drop any
        // single-finger touch stroke in progress without saving it.
        if (this.touchStrokeId !== null) {
          this.activePenId = null;
          this.touchStrokeId = null;
          this.currentPoints = [];
          this.filterX = null;
          this.filterY = null;
          this.clearActiveCanvas();
        }
        const [a, b] = [...this.activeTouches.values()];
        this.lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      } else if (this.allowTouchDraw && this.activePenId === null) {
        e.preventDefault();
        this.touchStrokeId = e.pointerId;
        this.startPenStroke(e);
      }
    }
  }

  movePenStroke(e) {
    // Recovery guard: iPadOS occasionally swallows pointerdown on rapid strokes
    if (this.activePenId === null && e.buttons > 0) {
      this.startPenStroke(e);
      return;
    }

    if (e.pointerId !== this.activePenId) return;

    // Hover guard: Pencil lifted off glass without firing pointerup
    if (e.buttons === 0) {
      this.commitPenStroke();
      return;
    }

    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const sample of coalesced) {
      const raw = this.toCanvasCoords(sample);
      this.currentPoints.push({
        x: this.filterX.filter(raw.x, raw.t),
        y: this.filterY.filter(raw.y, raw.t),
        pressure: raw.pressure,
        t: raw.t,
      });
    }

    // Append predicted points for visual zero-lag tip tracking (not saved to final stroke)
    const predicted = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
    const previewPoints =
      predicted.length > 0
        ? [...this.currentPoints, ...predicted.map((p) => this.toCanvasCoords(p))]
        : this.currentPoints;

    this.renderWetStroke(previewPoints);
  }

  handlePointerMove(e) {
    if (this.isPenLike(e)) {
      e.preventDefault();
      this.movePenStroke(e);
      return;
    }

    if (e.pointerType === 'touch' && this.touchStrokeId === e.pointerId) {
      e.preventDefault();
      // Keep the pinch anchor current: if a second finger lands mid-stroke,
      // the pinch must start from where this finger actually is, not
      // where it went down.
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.movePenStroke(e);
      return;
    }

    if (e.pointerType === 'touch' && this.activeTouches.has(e.pointerId)) {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2 && this.lastPinchMid) {
        const [a, b] = [...this.activeTouches.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);

        const dx = mid.x - this.lastPinchMid.x;
        const dy = mid.y - this.lastPinchMid.y;
        const scaleRatio = this.lastPinchDist > 0 ? dist / this.lastPinchDist : 1;

        this.lastPinchMid = mid;
        this.lastPinchDist = dist;
        this.onTwoFingerPanZoom({ dx, dy, scaleRatio, mid });
      }
    }
  }

  handlePointerUp(e) {
    if (this.isPenLike(e) && e.pointerId === this.activePenId) {
      this.commitPenStroke();
      return;
    }
    if (e.pointerType === 'touch') {
      if (this.touchStrokeId === e.pointerId) {
        this.touchStrokeId = null;
        this.commitPenStroke();
        return;
      }
      this.activeTouches.delete(e.pointerId);
      if (this.activeTouches.size < 2) {
        this.lastPinchMid = null;
        this.lastPinchDist = null;
      }
    }
  }

  handlePointerCancel(e) {
    if (this.isPenLike(e) && e.pointerId === this.activePenId) {
      this.commitPenStroke();
    }
    if (e.pointerType === 'touch') {
      if (this.touchStrokeId === e.pointerId) {
        this.touchStrokeId = null;
        this.commitPenStroke();
        return;
      }
      this.activeTouches.delete(e.pointerId);
      this.lastPinchMid = null;
      this.lastPinchDist = null;
    }
  }

  commitPenStroke() {
    const stroke = {
      tool: this.tool,
      color: this.color,
      baseWidth: this.baseWidth,
      points: [...this.currentPoints],
    };

    this.clearActiveCanvas();
    if (stroke.points.length > 0) {
      this.drawStrokeToContext(this.staticCtx, stroke);
      this.onStrokeComplete(stroke);
    }

    this.activePenId = null;
    this.touchStrokeId = null;
    this.currentPoints = [];
    this.filterX = null;
    this.filterY = null;
  }

  clearActiveCanvas() {
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  renderWetStroke(points) {
    this.clearActiveCanvas();
    this.drawStrokeToContext(this.activeCtx, {
      tool: this.tool,
      color: this.color,
      baseWidth: this.baseWidth,
      points,
    });
  }

  drawStrokeToContext(ctx, { tool, color, baseWidth, points }) {
    if (!points || points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }

    const widthFor = (p) =>
      tool === 'highlighter'
        ? baseWidth * 5
        : baseWidth * (0.45 + Math.pow(p, 0.75) * 0.95);

    if (points.length === 1) {
      const p0 = points[0];
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, widthFor(p0.pressure) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (points.length === 2) {
      ctx.beginPath();
      ctx.lineWidth = widthFor(points[1].pressure);
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Quadratic midpoint spline for smooth continuous curves
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];

      const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      ctx.beginPath();
      ctx.lineWidth = widthFor(p1.pressure);
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Zero adapter helpers.
//
// The engine works in canvas CSS pixels (its toCanvasCoords() measures
// against the canvas's on-screen rect, which is 900*zoom x 1200*zoom).
// Zero stores strokes in a fixed 900x1200 document space, as
// {tool, color, width, points: [[x, y, pressure]]}, so the app converts
// on the way in and out. Width converts the same way as coordinates:
// the app sets engine.baseWidth = width * zoom, so a committed stroke
// converts back to exactly the toolbar width.
//
// Eraser strokes are never stored: validateState() only allows
// 'pen' | 'highlighter', and Zero's eraser removes whole strokes.
// engineStrokeToZero() returns null for an eraser stroke; the app
// instead uses its points (via toDocPoint) to hit-test and remove
// the strokes it crossed, then re-renders the static canvas.
// ---------------------------------------------------------------------------

export function toDocPoint(p, zoom) {
  return [p.x / zoom, p.y / zoom, Math.max(0, Math.min(1, p.pressure ?? 0.5))];
}

export function engineStrokeToZero(stroke, zoom) {
  if (!stroke || stroke.tool === 'eraser' || !stroke.points?.length) return null;
  return {
    tool: stroke.tool,
    color: stroke.color,
    width: Math.max(0.1, Math.min(50, stroke.baseWidth / zoom)),
    points: stroke.points.map((p) => toDocPoint(p, zoom)),
  };
}

export function zeroStrokeToEngine(stroke, zoom) {
  return {
    tool: stroke.tool,
    color: stroke.color,
    baseWidth: stroke.width * zoom,
    points: stroke.points.map(([x, y, pressure]) => ({
      x: x * zoom,
      y: y * zoom,
      pressure,
      t: 0,
    })),
  };
}
