import {
  AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, effect, inject, signal, untracked
} from '@angular/core';
import {
  BRUSH_MODES, BrushMode, DEFAULT_PARAMS, FlowParams, FlowRenderer, PALETTES, Stroke
} from './flow-engine';

type SliderKey = 'particles' | 'scale' | 'swirl' | 'radius';

interface SliderConfig {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

export const MAX_STROKES = 12;
const MIN_POINT_GAP = 3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readParamsFromUrl(): FlowParams {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number) => {
    const raw = q.get(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    particles: clamp(Math.round(num('n', DEFAULT_PARAMS.particles) / 100) * 100, 500, 4000),
    scale: clamp(num('s', DEFAULT_PARAMS.scale), 1, 12),
    swirl: clamp(num('w', DEFAULT_PARAMS.swirl), 0.5, 5),
    palette: clamp(Math.round(num('p', DEFAULT_PARAMS.palette)), 0, PALETTES.length - 1),
    symmetry: clamp(Math.round(num('y', DEFAULT_PARAMS.symmetry)), 0, 2) as 0 | 1 | 2,
    seed: clamp(Math.round(num('seed', DEFAULT_PARAMS.seed)), 1, 999999),
    brush: BRUSH_MODES[clamp(Math.round(num('b', BRUSH_MODES.indexOf(DEFAULT_PARAMS.brush))), 0, BRUSH_MODES.length - 1)],
    radius: clamp(Math.round(num('r', DEFAULT_PARAMS.radius) / 10) * 10, 40, 240)
  };
}

function writeParamsToUrl(p: FlowParams): void {
  const q = new URLSearchParams({
    n: String(p.particles), s: String(p.scale), w: String(p.swirl),
    p: String(p.palette), y: String(p.symmetry), seed: String(p.seed),
    b: String(BRUSH_MODES.indexOf(p.brush)), r: String(p.radius)
  });
  history.replaceState(null, '', `?${q.toString()}`);
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('overlay', { static: true }) private overlayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage', { static: true }) private stageRef!: ElementRef<HTMLElement>;

  readonly palettes = PALETTES;
  readonly symmetryOptions = ['Off', 'Mirror', 'Kaleidoscope'];
  readonly brushOptions: { mode: BrushMode; label: string; hint: string }[] = [
    { mode: 'emit', label: 'Emit', hint: 'Particles are born along your line and stream outward.' },
    { mode: 'attract', label: 'Attract', hint: 'Your line pulls particles into orbit around it.' },
    { mode: 'repel', label: 'Repel', hint: 'Your line pushes particles away and leaves a clear halo.' }
  ];
  readonly sliders: SliderConfig[] = [
    { key: 'particles', label: 'Particles', min: 500, max: 4000, step: 100, format: (v) => String(v) },
    { key: 'scale', label: 'Noise scale', min: 1, max: 12, step: 0.5, format: (v) => (v / 1000).toFixed(4) },
    { key: 'swirl', label: 'Swirl', min: 0.5, max: 5, step: 0.5, format: (v) => v.toFixed(1) },
    { key: 'radius', label: 'Brush reach', min: 40, max: 240, step: 10, format: (v) => `${v} px` }
  ];

  readonly params = signal<FlowParams>(readParamsFromUrl());
  readonly strokes = signal<Stroke[]>([]);
  readonly drawMode = signal(window.matchMedia('(pointer: fine)').matches);
  readonly drawing = signal(true);
  readonly sketching = signal(false);
  readonly linkCopied = signal(false);

  private readonly zone = inject(NgZone);
  private readonly renderer = new FlowRenderer();
  private ctx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | undefined;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private liveStroke: [number, number][] | null = null;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    effect(() => {
      const p = this.params();
      this.strokes();
      untracked(() => {
        writeParamsToUrl(p);
        if (this.ctx) this.schedule(120);
      });
    });
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvasRef.nativeElement.getContext('2d');
    this.overlayCtx = this.overlayRef.nativeElement.getContext('2d');
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.schedule(250));
      this.resizeObserver.observe(this.stageRef.nativeElement);
      const overlay = this.overlayRef.nativeElement;
      overlay.addEventListener('pointerdown', this.onPointerDown);
      overlay.addEventListener('pointermove', this.onPointerMove);
      overlay.addEventListener('pointerup', this.onPointerUp);
      overlay.addEventListener('pointercancel', this.onPointerUp);
    });
    this.schedule(0);
  }

  ngOnDestroy(): void {
    clearTimeout(this.drawTimer);
    clearTimeout(this.copiedTimer);
    this.resizeObserver?.disconnect();
    this.renderer.stop();
  }

  setSlider(key: SliderKey, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.params.update((p) => ({ ...p, [key]: value }));
  }

  setPalette(index: number): void {
    this.params.update((p) => ({ ...p, palette: index }));
  }

  setSymmetry(index: number): void {
    this.params.update((p) => ({ ...p, symmetry: index as 0 | 1 | 2 }));
  }

  setBrush(mode: BrushMode): void {
    this.params.update((p) => ({ ...p, brush: mode }));
  }

  toggleDraw(): void {
    this.drawMode.update((on) => !on);
  }

  randomize(): void {
    this.params.update((p) => ({ ...p, seed: Math.floor(Math.random() * 9000) + 1000 }));
  }

  undoStroke(): void {
    this.strokes.update((s) => s.slice(0, -1));
  }

  clearStrokes(): void {
    this.strokes.set([]);
  }

  /** Adds a random flowing curve, for anyone who would rather not draw by hand. */
  addSurpriseStroke(): void {
    const r = () => Math.random();
    const ax = 0.12 + r() * 0.28;
    const ay = 0.12 + r() * 0.28;
    const fx = 1 + Math.floor(r() * 3);
    const fy = 1 + Math.floor(r() * 3);
    const phase = r() * Math.PI * 2;
    const cx = 0.35 + r() * 0.3;
    const cy = 0.35 + r() * 0.3;
    const points: [number, number][] = [];
    for (let i = 0; i <= 140; i++) {
      const t = (i / 140) * Math.PI * 2;
      points.push([
        clamp(cx + ax * Math.sin(fx * t + phase), 0.04, 0.96),
        clamp(cy + ay * Math.sin(fy * t), 0.04, 0.96)
      ]);
    }
    this.commitStroke(points);
  }

  savePng(): void {
    const canvas = this.canvasRef.nativeElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `flow-studio-${this.params().seed}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.linkCopied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.linkCopied.set(false), 1800);
    } catch {
      this.linkCopied.set(false);
    }
  }

  brushHint(): string {
    return this.brushOptions.find((b) => b.mode === this.params().brush)?.hint ?? '';
  }

  commitStroke(points: [number, number][]): void {
    if (points.length === 0) return;
    const stroke: Stroke = points.length === 1 ? [points[0], points[0]] : points;
    this.zone.run(() => this.strokes.update((s) => [...s.slice(-(MAX_STROKES - 1)), stroke]));
  }

  private normalise(event: PointerEvent): [number, number] {
    const rect = this.overlayRef.nativeElement.getBoundingClientRect();
    return [
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top) / rect.height, 0, 1)
    ];
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.drawMode() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.overlayRef.nativeElement.setPointerCapture(event.pointerId);
    this.liveStroke = [this.normalise(event)];
    this.zone.run(() => this.sketching.set(true));
    this.paintLive();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const live = this.liveStroke;
    if (!live) return;
    const rect = this.overlayRef.nativeElement.getBoundingClientRect();
    const [nx, ny] = this.normalise(event);
    const [lx, ly] = live[live.length - 1];
    if (Math.hypot((nx - lx) * rect.width, (ny - ly) * rect.height) < MIN_POINT_GAP) return;
    live.push([nx, ny]);
    this.paintLive();
  };

  private readonly onPointerUp = (): void => {
    const live = this.liveStroke;
    this.liveStroke = null;
    this.clearOverlay();
    this.zone.run(() => this.sketching.set(false));
    if (live) this.commitStroke(live);
  };

  private paintLive(): void {
    const ctx = this.overlayCtx;
    const live = this.liveStroke;
    if (!ctx || !live) return;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(76, 224, 179, 0.95)';
    ctx.shadowColor = 'rgba(76, 224, 179, 0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    live.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * width, y * height); else ctx.lineTo(x * width, y * height);
    });
    if (live.length === 1) ctx.lineTo(live[0][0] * width + 0.1, live[0][1] * height);
    ctx.stroke();
  }

  private clearOverlay(): void {
    const ctx = this.overlayCtx;
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private schedule(delay: number): void {
    this.drawing.set(true);
    clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => this.draw(), delay);
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const canvas = this.canvasRef.nativeElement;
    const overlay = this.overlayRef.nativeElement;
    const stage = this.stageRef.nativeElement;
    const width = Math.max(1, Math.floor(stage.clientWidth));
    const height = Math.max(1, Math.floor(stage.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
    this.zone.runOutsideAngular(() => {
      this.renderer.render(ctx, this.params(), this.strokes(), this.reduceMotion, () => {
        this.zone.run(() => this.drawing.set(false));
      });
    });
  }
}
