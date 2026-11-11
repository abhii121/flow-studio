import { TestBed } from '@angular/core/testing';
import { AppComponent, MAX_STROKES } from './app.component';
import { PALETTES } from './flow-engine';

describe('AppComponent', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/');
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
  });

  it('renders the studio title and one swatch per palette', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('FLOW STUDIO');
    expect(el.querySelectorAll('.swatch').length).toBe(PALETTES.length);
  });

  it('restores settings from the URL so shared links reproduce the artwork', () => {
    history.replaceState(null, '', '/?n=1500&s=6&w=3&p=2&y=1&seed=777&b=1&r=160');
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.params()).toEqual({
      particles: 1500, scale: 6, swirl: 3, palette: 2, symmetry: 1, seed: 777, brush: 'attract', radius: 160
    });
  });

  it('clamps out-of-range URL values', () => {
    history.replaceState(null, '', '/?n=999999&p=42&y=9&seed=-5&b=77&r=5');
    const { params } = TestBed.createComponent(AppComponent).componentInstance;
    expect(params().particles).toBe(4000);
    expect(params().palette).toBe(PALETTES.length - 1);
    expect(params().symmetry).toBe(2);
    expect(params().seed).toBe(1);
    expect(params().brush).toBe('repel');
    expect(params().radius).toBe(40);
  });

  it('randomize changes only the seed', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const before = app.params();
    app.randomize();
    expect(app.params().palette).toBe(before.palette);
    expect(app.params().particles).toBe(before.particles);
    expect(app.params().seed).toBeGreaterThanOrEqual(1000);
  });

  it('switches the brush behaviour', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.setBrush('repel');
    expect(app.params().brush).toBe('repel');
    expect(app.brushHint()).toContain('pushes');
  });

  it('adds, undoes and clears strokes', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.commitStroke([[0.1, 0.1], [0.4, 0.5]]);
    app.addSurpriseStroke();
    expect(app.strokes().length).toBe(2);
    app.undoStroke();
    expect(app.strokes().length).toBe(1);
    app.clearStrokes();
    expect(app.strokes().length).toBe(0);
  });

  it('turns a single tap into a drawable stroke', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.commitStroke([[0.5, 0.5]]);
    expect(app.strokes()[0].length).toBe(2);
  });

  it('keeps only the most recent strokes once the limit is reached', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    for (let i = 0; i < MAX_STROKES + 3; i++) app.commitStroke([[0.1, i / 100], [0.2, i / 100]]);
    expect(app.strokes().length).toBe(MAX_STROKES);
    expect(app.strokes()[MAX_STROKES - 1][0][1]).toBeCloseTo((MAX_STROKES + 2) / 100);
  });
});
