import {
  AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, effect, inject, signal, untracked
} from '@angular/core';
import { DEFAULT_PARAMS, FlowParams, FlowRenderer, PALETTES } from './flow-engine';

type SliderKey = 'particles' | 'scale' | 'swirl';

interface SliderConfig {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

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
    seed: clamp(Math.round(num('seed', DEFAULT_PARAMS.seed)), 1, 999999)
  };
}

function writeParamsToUrl(p: FlowParams): void {
  const q = new URLSearchParams({
    n: String(p.particles), s: String(p.scale), w: String(p.swirl),
    p: String(p.palette), y: String(p.symmetry), seed: String(p.seed)
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
  @ViewChild('stage', { static: true }) private stageRef!: ElementRef<HTMLElement>;

  readonly palettes = PALETTES;
  readonly symmetryOptions = ['Off', 'Mirror', 'Kaleidoscope'];
  readonly sliders: SliderConfig[] = [
    { key: 'particles', label: 'Particles', min: 500, max: 4000, step: 100, format: (v) => String(v) },
    { key: 'scale', label: 'Noise scale', min: 1, max: 12, step: 0.5, format: (v) => (v / 1000).toFixed(4) },
    { key: 'swirl', label: 'Swirl', min: 0.5, max: 5, step: 0.5, format: (v) => v.toFixed(1) }
  ];

  readonly params = signal<FlowParams>(readParamsFromUrl());
  readonly drawing = signal(true);
  readonly linkCopied = signal(false);

  private readonly zone = inject(NgZone);
  private readonly renderer = new FlowRenderer();
  private ctx: CanvasRenderingContext2D | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | undefined;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    effect(() => {
      const p = this.params();
      untracked(() => {
        writeParamsToUrl(p);
        if (this.ctx) this.schedule(120);
      });
    });
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvasRef.nativeElement.getContext('2d');
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.schedule(250));
      this.resizeObserver.observe(this.stageRef.nativeElement);
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

  randomize(): void {
    this.params.update((p) => ({ ...p, seed: Math.floor(Math.random() * 9000) + 1000 }));
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

  private schedule(delay: number): void {
    this.drawing.set(true);
    clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => this.draw(), delay);
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const canvas = this.canvasRef.nativeElement;
    const stage = this.stageRef.nativeElement;
    const width = Math.max(1, Math.floor(stage.clientWidth));
    const height = Math.max(1, Math.floor(stage.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.zone.runOutsideAngular(() => {
      this.renderer.render(ctx, this.params(), this.reduceMotion, () => {
        this.zone.run(() => this.drawing.set(false));
      });
    });
  }
}
