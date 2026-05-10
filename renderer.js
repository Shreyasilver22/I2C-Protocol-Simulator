/**
 * renderer.js — HTML5 Canvas Logic Analyzer Renderer
 * Real-time waveform plotting using requestAnimationFrame
 */

'use strict';

class WaveformRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this._raf = null;
    this._zoom = 1;
    this._offsetX = 0;
    this.bus = null;
    this._dirty = false;

    // Colors
    this.C = {
      bg:       '#0d1117',
      grid:     '#1c2333',
      gridLine: '#21262d',
      scl:      '#d2a8ff',
      sclGlow:  'rgba(210,168,255,0.25)',
      sda:      '#58a6ff',
      sdaGlow:  'rgba(88,166,255,0.25)',
      label:    '#484f58',
      start:    '#f85149',
      stop:     '#f85149',
      ack:      '#3fb950',
      nack:     '#f85149',
      addr:     '#d2a8ff',
      data:     '#ffa657',
      bitText:  '#8b949e',
    };

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this.canvas.parentElement);
    this._onResize();
  }

  _onResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width  = Math.floor(rect.width)  || 800;
    this.canvas.height = Math.floor(rect.height) || 240;
    this._dirty = true;
  }

  attach(bus) {
    this.bus = bus;
    this.start();
  }

  start() {
    if (this._raf) return;
    const loop = () => {
      if (this._dirty || (this.bus && this.bus.sclHistory.length > 0)) {
        this.draw();
        this._dirty = false;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  markDirty() { this._dirty = true; }

  zoomIn()  { this._zoom = Math.min(this._zoom * 1.4, 12); this._dirty = true; }
  zoomOut() { this._zoom = Math.max(this._zoom / 1.4, 0.3); this._dirty = true; }

  draw() {
    if (!this.bus) return;
    const { ctx, canvas, bus } = this;
    const W = canvas.width, H = canvas.height;
    const scl = bus.sclHistory, sda = bus.sdaHistory;
    const N = scl.length;

    // Background
    ctx.fillStyle = this.C.bg;
    ctx.fillRect(0, 0, W, H);

    if (N < 2) { this._drawIdleLines(W, H); return; }

    // Grid
    this._drawGrid(W, H);

    // Waveform rows
    const rowH = H / 2;
    const pad  = 10;
    const hiY_scl = rowH * 0.18;
    const loY_scl = rowH * 0.78;
    const hiY_sda = rowH + rowH * 0.18;
    const loY_sda = rowH + rowH * 0.78;

    const stepX = Math.max(1, ((W - pad * 2) / Math.max(N - 1, 1)) * this._zoom);
    const totalW = stepX * (N - 1);
    const startX = pad + this._offsetX;

    // ── SCL ──
    this._drawSignal(scl, N, startX, stepX, hiY_scl, loY_scl, this.C.scl, this.C.sclGlow, W, H);

    // ── SDA ──
    this._drawSignal(sda, N, startX, stepX, hiY_sda, loY_sda, this.C.sda, this.C.sdaGlow, W, H);

    // ── Divider ──
    ctx.beginPath();
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(0, rowH);
    ctx.lineTo(W, rowH);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Annotations ──
    this._drawAnnotations(bus.annotations, startX, stepX, rowH, hiY_scl, hiY_sda, W);

    // ── Timing Violation Markers ──
    if (bus.timingViolations && bus.timingViolations.length > 0) {
      this._drawTimingViolations(bus.timingViolations, startX, stepX, rowH, W);
    }

    // ── Bit labels ──
    this._drawBitLabels(scl, sda, N, startX, stepX, rowH, loY_sda, W);
  }

  _drawIdleLines(W, H) {
    const rowH = H / 2;
    const hiY_scl = rowH * 0.35;
    const hiY_sda = rowH + rowH * 0.35;
    [
      { y: hiY_scl, color: this.C.scl },
      { y: hiY_sda, color: this.C.sda },
    ].forEach(({ y, color }) => {
      this.ctx.beginPath();
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 0.3;
      this.ctx.moveTo(0, y); this.ctx.lineTo(W, y);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    });
  }

  _drawGrid(W, H) {
    const ctx = this.ctx;
    const cols = 20;
    ctx.strokeStyle = this.C.gridLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    for (let i = 0; i <= cols; i++) {
      const x = (W / cols) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  _drawSignal(arr, N, startX, stepX, hiY, loY, color, glowColor, W) {
    const ctx = this.ctx;
    const getY = (v) => v === 1 ? hiY : loY;

    // Glow pass
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, getY(arr[0]));
    for (let i = 1; i < N; i++) {
      const x = startX + i * stepX;
      if (x < -stepX || x > W + stepX) continue;
      if (arr[i] !== arr[i - 1]) {
        ctx.lineTo(x, getY(arr[i - 1])); // vertical edge
      }
      ctx.lineTo(x, getY(arr[i]));
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawAnnotations(annotations, startX, stepX, rowH, hiY_scl, hiY_sda, W) {
    const ctx = this.ctx;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    annotations.forEach(({ index, type, label }) => {
      const x = startX + index * stepX;
      if (x < 0 || x > W) return;

      let color, bgColor, y;
      switch (type) {
        case 'start': color = this.C.start; bgColor = 'rgba(248,81,73,0.15)'; y = hiY_scl - 16; break;
        case 'stop':  color = this.C.stop;  bgColor = 'rgba(248,81,73,0.15)'; y = hiY_scl - 16; break;
        default: return;
      }

      const tw = ctx.measureText(label).width;
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(x - tw/2 - 4, y - 11, tw + 8, 14, 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);

      // Vertical marker line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(x, 0); ctx.lineTo(x, rowH * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left';
  }

  _drawBitLabels(scl, sda, N, startX, stepX, rowH, loY_sda, W) {
    const ctx = this.ctx;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.C.bitText;

    for (let i = 1; i < N; i++) {
      if (scl[i - 1] === 0 && scl[i] === 1) {
        const x = startX + i * stepX;
        if (x < 0 || x > W) continue;
        const bit = sda[i];
        ctx.fillStyle = bit === 1 ? '#484f58' : '#58a6ff';
        ctx.fillText(bit, x, loY_sda + 14);
      }
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  /** Draw yellow ⚠ diamonds at timing violation sample positions */
  _drawTimingViolations(violations, startX, stepX, rowH, W) {
    const ctx = this.ctx;
    const color = '#e3b341';
    ctx.save();
    violations.forEach(({ index }) => {
      const x = startX + index * stepX;
      if (x < 0 || x > W) return;
      // Dashed vertical line spanning both channels
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rowH * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Diamond marker at top
      const s = 5;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.moveTo(x,     4);
      ctx.lineTo(x + s, 4 + s);
      ctx.lineTo(x,     4 + s * 2);
      ctx.lineTo(x - s, 4 + s);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }
}

