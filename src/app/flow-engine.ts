export interface Palette {
  name: string;
  stops: [number, number, number][];
}

export type BrushMode = 'emit' | 'attract' | 'repel';
export const BRUSH_MODES: BrushMode[] = ['emit', 'attract', 'repel'];

export interface FlowParams {
  particles: number;
  scale: number;
  swirl: number;
  palette: number;
  symmetry: 0 | 1 | 2;
  seed: number;
  brush: BrushMode;
  radius: number;
}

/** A hand-drawn line. Points are normalised to 0..1 so strokes survive canvas resizes. */
export type Stroke = readonly (readonly [number, number])[];

export const PALETTES: Palette[] = [
  { name: 'Aurora', stops: [[76, 224, 179], [0, 170, 255], [212, 118, 255]] },
  { name: 'Ember', stops: [[255, 90, 54], [255, 190, 90], [255, 240, 200]] },
  { name: 'Ocean', stops: [[8, 90, 140], [40, 190, 210], [210, 250, 245]] },
  { name: 'Mono', stops: [[90, 100, 120], [200, 210, 225], [255, 255, 255]] }
];

export const DEFAULT_PARAMS: FlowParams = {
  particles: 2200,
  scale: 3.5,
  swirl: 2,
  palette: 0,
  symmetry: 0,
  seed: 4821,
  brush: 'emit',
  radius: 120
};

const TOTAL_STEPS = 330;
const STEP_LENGTH = 1.6;
const BACKGROUND = '#05070b';
// The particle slider is tuned for a canvas of this size; other sizes scale the count
// so the artwork keeps the same density (and brightness) on phones and big monitors.
const REFERENCE_AREA = 940 * 760;
const STROKE_SPACING = 6;

export function createRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed: number): (x: number, y: number) => number {
  const random = createRandom(seed);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  const grad = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);

  return (px: number, py: number) => {
    const xi = Math.floor(px);
    const yi = Math.floor(py);
    const X = xi & 255;
    const Y = yi & 255;
    const x = px - xi;
    const y = py - yi;
    const u = fade(x);
    const v = fade(y);
    const a = perm[X] + Y;
    const b = perm[X + 1] + Y;
    return lerp(
      lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u),
      v
    );
  };
}

export function buildColorTable(palette: Palette): string[] {
  const table: string[] = [];
  const last = palette.stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * last;
    const k = Math.min(last - 1, Math.floor(t));
    const f = t - k;
    const [r0, g0, b0] = palette.stops[k];
    const [r1, g1, b1] = palette.stops[k + 1];
    table.push(`rgba(${Math.round(r0 + (r1 - r0) * f)},${Math.round(g0 + (g1 - g0) * f)},${Math.round(b0 + (b1 - b0) * f)},0.16)`);
  }
  return table;
}

/** Hand-drawn strokes resampled into evenly spaced points with a grid for fast lookups. */
export interface StrokeField {
  xs: number[];
  ys: number[];
  cell: number;
  cols: number;
  grid: Map<number, number[]>;
}

export function buildStrokeField(strokes: readonly Stroke[], width: number, height: number, radius: number): StrokeField | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const stroke of strokes) {
    let px = 0;
    let py = 0;
    stroke.forEach(([nx, ny], i) => {
      const x = nx * width;
      const y = ny * height;
      if (i === 0) {
        xs.push(x);
        ys.push(y);
      } else {
        const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / STROKE_SPACING));
        for (let k = 1; k <= steps; k++) {
          xs.push(px + ((x - px) * k) / steps);
          ys.push(py + ((y - py) * k) / steps);
        }
      }
      px = x;
      py = y;
    });
  }
  if (xs.length === 0) return null;

  const cell = Math.max(16, radius);
  const cols = Math.ceil(width / cell) + 2;
  const grid = new Map<number, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const key = Math.floor(xs[i] / cell) + Math.floor(ys[i] / cell) * cols;
    const bucket = grid.get(key);
    if (bucket) bucket.push(i); else grid.set(key, [i]);
  }
  return { xs, ys, cell, cols, grid };
}

/** Index of the closest stroke point within `radius`, or -1 when none is near. */
export function nearestStrokePoint(field: StrokeField, x: number, y: number, radius: number): number {
  const cx = Math.floor(x / field.cell);
  const cy = Math.floor(y / field.cell);
  let best = -1;
  let bestDist = radius * radius;
  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      const bucket = field.grid.get(gx + gy * field.cols);
      if (!bucket) continue;
      for (const i of bucket) {
        const dx = field.xs[i] - x;
        const dy = field.ys[i] - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = i; }
      }
    }
  }
  return best;
}

interface Particle {
  x: number;
  y: number;
  life: number;
}

/**
 * Draws a flow-field picture into a 2D canvas. The same params and strokes always
 * produce the same picture. Drawing is spread across animation frames so the art
 * visibly grows and the page stays responsive; pass `instant` to draw everything at once.
 */
export class FlowRenderer {
  private frameId = 0;
  private token = 0;

  stop(): void {
    this.token++;
    cancelAnimationFrame(this.frameId);
  }

  render(
    ctx: CanvasRenderingContext2D,
    params: FlowParams,
    strokes: readonly Stroke[],
    instant: boolean,
    onDone: () => void
  ): void {
    this.stop();
    const token = this.token;
    const { width, height } = ctx.canvas;
    const noise = createNoise(params.seed);
    const random = createRandom(params.seed + 7);
    const colors = buildColorTable(PALETTES[params.palette]);
    const noiseScale = params.scale * 0.001;
    const swirlRange = Math.PI * params.swirl;
    const radius = params.radius;
    const field = buildStrokeField(strokes, width, height, radius);
    const emit = field !== null && params.brush === 'emit';
    const attract = params.brush === 'attract';

    const spawn = (p: Particle) => {
      if (emit && field && random() < 0.75) {
        const i = Math.floor(random() * field.xs.length);
        p.x = field.xs[i] + (random() - 0.5) * radius * 0.3;
        p.y = field.ys[i] + (random() - 0.5) * radius * 0.3;
      } else {
        p.x = random() * width;
        p.y = random() * height;
      }
      p.life = 60 + random() * 220;
    };

    const density = Math.min(1.5, Math.max(0.25, (width * height) / REFERENCE_AREA));
    const count = Math.round(params.particles * density);
    const particles: Particle[] = Array.from({ length: count }, () => {
      const p = { x: 0, y: 0, life: 0 };
      spawn(p);
      return p;
    });

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    this.drawGuides(ctx, strokes, params.symmetry, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 0.8;

    const stepOnce = () => {
      const batches = new Map<number, number[]>();
      for (const p of particles) {
        const angle = noise(p.x * noiseScale, p.y * noiseScale) * swirlRange;
        let vx = Math.cos(angle);
        let vy = Math.sin(angle);
        let index = Math.floor((angle / swirlRange * 0.5 + 0.5) * 255);

        if (field && !emit) {
          const hit = nearestStrokePoint(field, p.x, p.y, radius);
          if (hit >= 0) {
            let dx = field.xs[hit] - p.x;
            let dy = field.ys[hit] - p.y;
            const dist = Math.hypot(dx, dy) || 0.001;
            dx /= dist;
            dy /= dist;
            const t = 1 - dist / radius;
            const w = t * t * (3 - 2 * t);
            if (attract) {
              vx = vx * (1 - 0.75 * w) + (dx * 0.55 - dy * 0.95) * w;
              vy = vy * (1 - 0.75 * w) + (dy * 0.55 + dx * 0.95) * w;
              index += w * 90;
            } else {
              vx = vx * (1 - 0.75 * w) + (-dx - dy * 0.5) * w;
              vy = vy * (1 - 0.75 * w) + (-dy + dx * 0.5) * w;
              index -= w * 90;
            }
          }
        }

        const nx = p.x + vx * STEP_LENGTH;
        const ny = p.y + vy * STEP_LENGTH;
        index = Math.min(255, Math.max(0, Math.floor(index)));
        let batch = batches.get(index);
        if (!batch) { batch = []; batches.set(index, batch); }
        batch.push(p.x, p.y, nx, ny);
        p.x = nx;
        p.y = ny;
        p.life--;
        if (p.life <= 0 || nx < 0 || nx > width || ny < 0 || ny > height) spawn(p);
      }
      batches.forEach((lines, index) => {
        ctx.strokeStyle = colors[index];
        ctx.beginPath();
        for (let i = 0; i < lines.length; i += 4) {
          const [x0, y0, x1, y1] = [lines[i], lines[i + 1], lines[i + 2], lines[i + 3]];
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          if (params.symmetry >= 1) { ctx.moveTo(width - x0, y0); ctx.lineTo(width - x1, y1); }
          if (params.symmetry >= 2) {
            ctx.moveTo(x0, height - y0); ctx.lineTo(x1, height - y1);
            ctx.moveTo(width - x0, height - y0); ctx.lineTo(width - x1, height - y1);
          }
        }
        ctx.stroke();
      });
    };

    const finish = () => {
      ctx.globalCompositeOperation = 'source-over';
      onDone();
    };

    if (instant) {
      for (let s = 0; s < TOTAL_STEPS; s++) stepOnce();
      finish();
      return;
    }

    let done = 0;
    const tick = () => {
      if (token !== this.token) return;
      const batch = Math.min(6, TOTAL_STEPS - done);
      for (let i = 0; i < batch; i++) stepOnce();
      done += batch;
      if (done >= TOTAL_STEPS) { finish(); return; }
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  /** A faint trace of the drawn lines so people can see what they sketched. */
  private drawGuides(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], symmetry: number, width: number, height: number): void {
    if (strokes.length === 0) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    const flips: [number, number][] = [[1, 1]];
    if (symmetry >= 1) flips.push([-1, 1]);
    if (symmetry >= 2) flips.push([1, -1], [-1, -1]);
    for (const [fx, fy] of flips) {
      ctx.beginPath();
      for (const stroke of strokes) {
        stroke.forEach(([nx, ny], i) => {
          const x = fx === 1 ? nx * width : width - nx * width;
          const y = fy === 1 ? ny * height : height - ny * height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
