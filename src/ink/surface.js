// The writing line: a ruled canvas that takes pen, finger or mouse input.
//
// It knows where its own baseline and x-height are, which is what lets the reader
// treat vertical position as meaning rather than noise — `l` is tall, `p` hangs below.

const BASELINE_RATIO = 0.68; // of the line's height
const XHEIGHT_RATIO = 0.3;
const ERASER_RADIUS = 14;

export class InkLine {
  /**
   * @param {object} options
   * @param {number} options.height line height in CSS pixels
   * @param {boolean} [options.readOnly] finished rows keep their ink but take no input
   * @param {(line: InkLine) => void} [options.onChange] fired when a stroke lands or is erased
   * @param {boolean} [options.guides] draw the ruled lines
   */
  constructor({ height = 96, readOnly = false, onChange = null, guides = true, tool = 'pencil' } = {}) {
    this.height = height;
    this.readOnly = readOnly;
    this.onChange = onChange;
    this.guides = guides;
    this.tool = tool;
    this.strokes = [];
    this.history = [];
    this.active = new Map(); // pointerId → stroke being drawn right now
    this.erasing = null;
    this.penSeen = false; // once a stylus writes, ignore the palm

    this.el = document.createElement('div');
    this.el.className = 'ink-line';
    this.el.style.height = `${height}px`;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ink-canvas';
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    if (!readOnly) {
      this.canvas.addEventListener('pointerdown', this.onDown);
      this.canvas.addEventListener('pointermove', this.onMove);
      this.canvas.addEventListener('pointerup', this.onUp);
      this.canvas.addEventListener('pointercancel', this.onUp);
      this.canvas.addEventListener('lostpointercapture', this.onUp);
    }

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.el);
    queueMicrotask(() => this.resize());
  }

  get baselineY() {
    return this.height * BASELINE_RATIO;
  }

  get xHeight() {
    return this.height * XHEIGHT_RATIO;
  }

  resize() {
    const width = this.el.clientWidth || 320;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.redraw();
  }

  // — input ————————————————————————————————————————————————

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      p: event.pressure > 0 && event.pressure !== 0.5 ? event.pressure : 0.5,
    };
  }

  /**
   * A hand resting on a tablet produces its own pointers alongside the stylus, so
   * every pointer gets its own in-progress stroke. Sharing one would let the palm's
   * pointerup finish the pen's stroke — the pen would simply stop drawing mid-letter.
   */
  ignores(event) {
    return this.penSeen && event.pointerType === 'touch';
  }

  /** The pen has landed: anything the hand drew just before it was the palm. */
  dropPalmMarks() {
    for (const [id, stroke] of this.active) {
      if (stroke.pointerType === 'touch') this.active.delete(id);
    }
    const now = performance.now();
    const palm = this.strokes.filter((s) => s.pointerType === 'touch' && now - s.finishedAt < 900);
    if (palm.length) {
      this.strokes = this.strokes.filter((s) => !palm.includes(s));
      this.history.push({ type: 'erase', strokes: palm });
      this.redraw();
    }
  }

  onDown = (event) => {
    if (this.readOnly) return;
    if (event.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true;
      this.dropPalmMarks();
    } else if (event.pointerType === 'pen') {
      this.dropPalmMarks();
    } else if (this.ignores(event)) {
      return;
    }

    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; without it the stroke still tracks the pointer.
    }

    const point = this.point(event);
    if (this.tool === 'eraser') {
      if (!this.erasing) this.erasing = { removed: [], pointerId: event.pointerId };
      this.eraseAt(point);
      return;
    }
    this.active.set(event.pointerId, {
      tool: this.tool,
      pointerType: event.pointerType,
      points: [point],
    });
  };

  onMove = (event) => {
    if (this.readOnly || this.ignores(event)) return;
    if (this.erasing && this.erasing.pointerId === event.pointerId) {
      this.eraseAt(this.point(event));
      return;
    }
    const stroke = this.active.get(event.pointerId);
    if (!stroke) return;
    event.preventDefault();
    // Coalesced events give the full path between frames, but the list comes back
    // empty in some browsers and for synthetic input — then the move itself is the path.
    const coalesced = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    const events = coalesced.length ? coalesced : [event];
    for (const raw of events) stroke.points.push(this.point(raw));
    this.redraw();
  };

  onUp = (event) => {
    if (this.erasing && this.erasing.pointerId === event.pointerId) {
      const removed = this.erasing.removed;
      this.erasing = null;
      if (removed.length) {
        this.history.push({ type: 'erase', strokes: removed });
        this.changed();
      }
      return;
    }

    const stroke = this.active.get(event.pointerId);
    if (!stroke) return;
    this.active.delete(event.pointerId);
    if (stroke.points.length === 1) {
      // A tap still leaves a dot — that is how the dot on an `i` gets written.
      stroke.points.push({ ...stroke.points[0], x: stroke.points[0].x + 0.6 });
    }
    stroke.finishedAt = performance.now();
    this.strokes.push(stroke);
    this.history.push({ type: 'add', stroke });
    this.changed();
  };

  eraseAt(point) {
    const keep = [];
    let removedAny = false;
    for (const stroke of this.strokes) {
      const hit = stroke.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < ERASER_RADIUS);
      if (hit) {
        this.erasing.removed.push(stroke);
        removedAny = true;
      } else {
        keep.push(stroke);
      }
    }
    if (removedAny) {
      this.strokes = keep;
      this.redraw();
    }
  }

  changed() {
    this.redraw();
    this.onChange?.(this);
  }

  // — editing ———————————————————————————————————————————————

  setTool(tool) {
    this.tool = tool;
    this.el.dataset.tool = tool;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return;
    if (last.type === 'add') this.strokes = this.strokes.filter((s) => s !== last.stroke);
    else this.strokes = [...this.strokes, ...last.strokes];
    this.changed();
  }

  clear() {
    if (!this.strokes.length) return;
    this.history.push({ type: 'erase', strokes: this.strokes });
    this.strokes = [];
    this.changed();
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  /** Ink the learner has drawn but not yet lifted the pen from. */
  isWriting() {
    return this.active.size > 0;
  }

  lock() {
    this.readOnly = true;
    this.el.dataset.locked = 'true';
  }

  /** Ink in template units: baseline at 0, one unit = one x-height. */
  templateStrokes() {
    const { baselineY, xHeight } = this;
    return this.strokes.map((stroke) => stroke.points.map((p) => [p.x / xHeight, (p.y - baselineY) / xHeight]));
  }

  // — painting ——————————————————————————————————————————————

  redraw() {
    const ctx = this.ctx;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.guides) this.drawGuides(ctx, this.el.clientWidth || width);
    for (const stroke of this.strokes) this.drawStroke(ctx, stroke);
    for (const stroke of this.active.values()) this.drawStroke(ctx, stroke);
  }

  drawGuides(ctx, width) {
    const style = getComputedStyle(this.el);
    ctx.save();
    ctx.strokeStyle = style.getPropertyValue('--guide-strong').trim() || '#c9d6d3';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, this.baselineY);
    ctx.lineTo(width, this.baselineY);
    ctx.stroke();

    ctx.strokeStyle = style.getPropertyValue('--guide-faint').trim() || '#e4ece9';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(0, this.baselineY - this.xHeight);
    ctx.lineTo(width, this.baselineY - this.xHeight);
    ctx.stroke();
    ctx.restore();
  }

  drawStroke(ctx, stroke) {
    const points = stroke.points;
    if (points.length < 2) return;
    const pencil = stroke.tool !== 'pen';
    const style = getComputedStyle(this.el);
    const colour = style.getPropertyValue(pencil ? '--ink-pencil' : '--ink-pen').trim() || '#2f3a38';
    const base = pencil ? 2.6 : 3.4;

    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = pencil ? 0.88 : 1;

    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      const speed = Math.hypot(to.x - from.x, to.y - from.y);
      // Pressure where the device reports it, speed as a stand-in where it does not.
      const weight = 0.55 + to.p * 0.9 - Math.min(speed / 40, 0.28);
      ctx.lineWidth = Math.max(1.1, base * weight);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      ctx.quadraticCurveTo(from.x, from.y, mid.x, mid.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  destroy() {
    this.observer.disconnect();
  }
}
