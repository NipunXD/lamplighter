import { describe, it, expect } from 'vitest';
import { generateBatch } from '../server/data/generate.js';

describe('synthetic batch', () => {
  it('is deterministic for a seed', () => {
    const a = generateBatch(42, 30); const b = generateBatch(42, 30);
    expect(a.cases.map((c) => c.id)).toEqual(b.cases.map((c) => c.id));
    expect([...a.hidden.values()].map((h) => h.archetype)).toEqual([...b.hidden.values()].map((h) => h.archetype));
  });
  it('never leaks hidden fields into cases', () => {
    const { cases } = generateBatch(1, 50);
    for (const c of cases) expect(JSON.stringify(c)).not.toMatch(/archetype|basePayProb|willSayStop/);
  });
  it('covers every case kind with 50+ records', () => {
    const { cases } = generateBatch(3, 80);
    const kinds = new Set(cases.map((c) => c.kind));
    expect(kinds.size).toBe(4);
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });
});
