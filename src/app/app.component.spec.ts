import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
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
    history.replaceState(null, '', '/?n=1500&s=6&w=3&p=2&y=1&seed=777');
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.params()).toEqual({
      particles: 1500, scale: 6, swirl: 3, palette: 2, symmetry: 1, seed: 777
    });
  });

  it('clamps out-of-range URL values', () => {
    history.replaceState(null, '', '/?n=999999&p=42&y=9&seed=-5');
    const { params } = TestBed.createComponent(AppComponent).componentInstance;
    expect(params().particles).toBe(4000);
    expect(params().palette).toBe(PALETTES.length - 1);
    expect(params().symmetry).toBe(2);
    expect(params().seed).toBe(1);
  });

  it('randomize changes only the seed', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const before = app.params();
    app.randomize();
    expect(app.params().palette).toBe(before.palette);
    expect(app.params().particles).toBe(before.particles);
    expect(app.params().seed).toBeGreaterThanOrEqual(1000);
  });
});
