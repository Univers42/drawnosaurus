/**
 * Eraser pointer trail effect, modeled after Excalidraw's LaserPointer & AnimatedTrail.
 * When dragging the eraser across the canvas, renders a smooth decaying streak ("destello")
 * that follows the pointer and tapers away over ~220ms.
 */

export interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

export interface EraserTrailOptions {
  /** Maximum lifespan of a point in milliseconds before decaying away completely (default: 220). */
  decayTime?: number;
  /** Maximum width of the trail stroke at full strength (default: 16). */
  size?: number;
  /** Smoothing factor between 0 (raw) and 1 (fully smoothed) (default: 0.25). */
  streamline?: number;
  /** Callback fired on each animation frame with the updated SVG path data. */
  onUpdate?: (pathD: string) => void;
}

export class EraserTrail {
  private points: TrailPoint[] = [];
  private decayTime: number;
  private size: number;
  private streamline: number;
  private onUpdate?: (pathD: string) => void;
  private rafId = 0;
  private isDrawing = false;

  constructor(options: EraserTrailOptions = {}) {
    this.decayTime = options.decayTime ?? 220;
    this.size = options.size ?? 16;
    this.streamline = Math.min(Math.max(options.streamline ?? 0.25, 0), 0.9);
    this.onUpdate = options.onUpdate;
  }

  /** Start a new stroke at (x, y). */
  start(x: number, y: number): void {
    this.points = [];
    this.isDrawing = true;
    this.addPoint(x, y);
  }

  /**
   * Add a point along the stroke — only while one is being drawn.
   *
   * Moves keep arriving after Escape has ended the sweep and while a space-drag pans
   * with the eraser chosen; drawing them left a live-looking trail over a gesture that
   * was erasing nothing.
   */
  addPoint(x: number, y: number): void {
    if (!this.isDrawing) return;
    const now = performance.now();
    const last = this.points[this.points.length - 1];

    if (last) {
      // Don't add duplicate points
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 1) {
        return;
      }

      // Apply streamlining
      if (this.streamline > 0) {
        x = last.x + (x - last.x) * (1 - this.streamline);
        y = last.y + (y - last.y) * (1 - this.streamline);
      }
    }

    this.points.push({ x, y, time: now });
    this.ensureLoop();
  }

  /** Release pointer: stop drawing new points and allow the trail to decay out. */
  stop(): void {
    this.isDrawing = false;
    this.ensureLoop();
  }

  /** Cancel and immediately clear all trail points. */
  clear(): void {
    this.points = [];
    this.isDrawing = false;
    if (this.rafId) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = 0;
    }
    this.onUpdate?.("");
  }

  get active(): boolean {
    return this.points.length > 0;
  }

  private ensureLoop(): void {
    if (this.rafId || typeof requestAnimationFrame === "undefined") return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.rafId = 0;
    const now = performance.now();

    // Prune expired points
    const cutoff = now - this.decayTime;
    let firstValid = 0;
    while (firstValid < this.points.length) {
      const point = this.points[firstValid];
      if (point && point.time < cutoff) {
        firstValid++;
      } else {
        break;
      }
    }
    if (firstValid > 0) {
      this.points.splice(0, firstValid);
    }

    if (this.points.length === 0) {
      this.onUpdate?.("");
      return;
    }

    const pathD = this.computePath(now);
    this.onUpdate?.(pathD);

    // Keep loop going if we still have points or are still drawing
    if (this.points.length > 0 || this.isDrawing) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  /**
   * Generates the SVG path polygon for the trail outline.
   */
  computePath(now: number = performance.now()): string {
    const len = this.points.length;
    if (len === 0) return "";

    if (len === 1) {
      const p = this.points[0];
      if (!p) return "";
      const age = now - p.time;
      const t = Math.max(0, 1 - age / this.decayTime);
      const r = (this.size / 2) * Math.sin((t * Math.PI) / 2);
      if (r < 0.5) return "";
      return `M ${p.x - r},${p.y} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`;
    }

    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];

    for (let i = 0; i < len; i++) {
      const cur = this.points[i];
      if (!cur) continue;
      const age = now - cur.time;
      const t = Math.max(0, 1 - age / this.decayTime);
      // Head-to-tail tapering and time decay
      const lengthFactor = Math.min((i + 1) / Math.min(len, 8), 1);
      const decayFactor = Math.sin((t * Math.PI) / 2);
      const radius = (this.size / 2) * decayFactor * lengthFactor;

      if (radius < 0.2) continue;

      let dx = 0;
      let dy = 0;
      if (i === 0) {
        const next = this.points[1];
        if (next) {
          dx = next.x - cur.x;
          dy = next.y - cur.y;
        }
      } else if (i === len - 1) {
        const prev = this.points[len - 2];
        if (prev) {
          dx = cur.x - prev.x;
          dy = cur.y - prev.y;
        }
      } else {
        const prev = this.points[i - 1];
        const next = this.points[i + 1];
        if (prev && next) {
          dx = next.x - prev.x;
          dy = next.y - prev.y;
        }
      }

      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;

      left.push({ x: cur.x + nx * radius, y: cur.y + ny * radius });
      right.push({ x: cur.x - nx * radius, y: cur.y - ny * radius });
    }

    if (left.length === 0) return "";

    // Build the outline: left forward, rounded cap at head, right backward
    const head = this.points[len - 1];
    if (!head) return "";
    const headAge = now - head.time;
    const headT = Math.max(0, 1 - headAge / this.decayTime);
    const headR = (this.size / 2) * Math.sin((headT * Math.PI) / 2);

    const outline: { x: number; y: number }[] = [...left];

    // Semicircle cap around head
    if (headR >= 0.5 && head) {
      const lastL = left[left.length - 1];
      const lastR = right[right.length - 1];
      if (lastL && lastR) {
        const angleL = Math.atan2(lastL.y - head.y, lastL.x - head.x);
        let angleR = Math.atan2(lastR.y - head.y, lastR.x - head.x);
        // Ensure clockwise rotation from L to R
        while (angleR < angleL) angleR += Math.PI * 2;
        const steps = 6;
        for (let s = 1; s < steps; s++) {
          const theta = angleL + ((angleR - angleL) * s) / steps;
          outline.push({
            x: head.x + Math.cos(theta) * headR,
            y: head.y + Math.sin(theta) * headR,
          });
        }
      }
    }

    // Right contour backwards
    for (let i = right.length - 1; i >= 0; i--) {
      const point = right[i];
      if (point) outline.push(point);
    }

    return smoothOutlinePath(outline);
  }
}

/**
 * Turns an ordered outline of points into a smooth SVG closed path using quadratic beziers.
 */
export function smoothOutlinePath(points: { x: number; y: number }[]): string {
  const len = points.length;
  if (len < 3) return "";

  const first = points[0];
  if (!first) return "";

  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 0; i < len; i++) {
    const cur = points[i];
    const next = points[(i + 1) % len];
    if (!cur || !next) continue;
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    d += ` Q ${cur.x.toFixed(1)},${cur.y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }
  d += " Z";
  return d;
}
