import {
  PALETTES, buildColorTable, buildStrokeField, createNoise, createRandom, nearestStrokePoint
} from './flow-engine';

describe('flow engine', () => {
  it('random generator is deterministic per seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it('noise is deterministic and bounded', () => {
    const n1 = createNoise(7);
    const n2 = createNoise(7);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      expect(n1(x, y)).toBe(n2(x, y));
      expect(Math.abs(n1(x, y))).toBeLessThanOrEqual(2);
    }
  });

  it('builds a 256-entry colour table for every palette', () => {
    for (const palette of PALETTES) {
      const table = buildColorTable(palette);
      expect(table.length).toBe(256);
      expect(table[0]).toMatch(/^rgba\(/);
    }
  });
});

describe('stroke field', () => {
  const stroke = [[0.1, 0.5], [0.9, 0.5]] as const;

  it('returns null when nothing is drawn', () => {
    expect(buildStrokeField([], 1000, 600, 100)).toBeNull();
  });

  it('resamples a line into evenly spaced points', () => {
    const field = buildStrokeField([stroke], 1000, 600, 100)!;
    expect(field.xs.length).toBeGreaterThan(100);
    expect(field.xs[0]).toBeCloseTo(100);
    expect(field.xs[field.xs.length - 1]).toBeCloseTo(900);
    expect(field.ys.every((y) => Math.abs(y - 300) < 0.001)).toBeTrue();
  });

  it('finds the nearest stroke point within the reach only', () => {
    const field = buildStrokeField([stroke], 1000, 600, 100)!;
    const near = nearestStrokePoint(field, 500, 340, 100);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(Math.abs(field.ys[near] - 300)).toBeLessThan(1);
    expect(Math.abs(field.xs[near] - 500)).toBeLessThan(6);
    expect(nearestStrokePoint(field, 500, 500, 100)).toBe(-1);
  });
});
