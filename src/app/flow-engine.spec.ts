import { PALETTES, buildColorTable, createNoise, createRandom } from './flow-engine';

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
