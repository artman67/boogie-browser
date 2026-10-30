import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appPaths } from '../paths';
import { lookalikes } from './index';
import { DIM, LooksModel, SIDE, modelDir, modelReady } from './model';
import { LooksStore } from './store';

const SCRATCH = resolve(import.meta.dirname, '../../../.tmp/looks-test');
mkdirSync(SCRATCH, { recursive: true });
const dir = mkdtempSync(join(SCRATCH, 'store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A unit vector pointing mostly along axis `k`. */
function unit(k: number, noise = 0.1): Float32Array {
  const v = new Float32Array(DIM).map((_, i) => (i === k ? 1 : noise * Math.sin(i * 7 + k)));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('LooksStore', () => {
  it('scores what was stored, tells unread from unreadable, and keeps it across opens', () => {
    const file = join(dir, 'a.sqlite');
    const s = new LooksStore(file);
    const a = unit(1);
    const b = unit(2);
    s.put([
      { id: 'A', stamp: '1:1', vector: a },
      { id: 'B', stamp: '2:2', vector: b },
      { id: 'X', stamp: '3:3', vector: null },
    ]);
    const got = s.scores(a, ['A', 'B', 'X', 'NEW']);
    expect(got[0]).toBeCloseTo(1, 2); // signed bytes lose a little, not the order
    expect(got[1]).toBeCloseTo(dot(a, b), 2);
    expect(got[2]).toBe(-Infinity);
    expect(got[3]).toBeNaN();
    s.close();

    const again = new LooksStore(file);
    expect(again.stamps()).toEqual(
      new Map([
        ['A', '1:1'],
        ['B', '2:2'],
        ['X', '3:3'],
      ]),
    );
    again.keepOnly(new Set(['B']));
    expect([...again.stamps().keys()]).toEqual(['B']);
    expect(again.scores(a, ['A'])[0]).toBeNaN();
    again.close();
  });
});

describe('lookalikes', () => {
  it('keeps the clear winners best first, leaves out what the words found, counts the unread', () => {
    const pool = Array.from({ length: 100 }, (_, i) => `I${i}`);
    // An even spread of ordinary pictures, three clear matches, two not read yet, one unreadable.
    const scores = Float64Array.from(pool, (_, i) => (i % 10) / 100);
    scores[40] = 0.5;
    scores[41] = 0.7;
    scores[42] = 0.6;
    scores[50] = NaN;
    scores[51] = NaN;
    scores[60] = -Infinity;
    const { ids, pending } = lookalikes(pool, scores, new Set(['I42']));
    expect(ids).toEqual(['I41', 'I40']);
    expect(pending).toBe(2);
  });
});

// The real model, when it has been downloaded (the app does that on first start).
const real = process.env.BOOGIE_LOOKS_MODEL ?? modelDir(appPaths({}).cache);
describe.skipIf(!(await modelReady(real)))('the model', () => {
  it('tells a red picture from a blue one by the words', async () => {
    const model = new LooksModel(real);
    try {
      const px = new Uint8Array(2 * SIDE * SIDE * 3);
      for (let p = 0; p < SIDE * SIDE; p++) {
        px[p * 3] = 220; // the first picture is red
        px[(SIDE * SIDE + p) * 3 + 2] = 220; // the second is blue
      }
      const v = await model.images(px, 2);
      const red = v.subarray(0, DIM);
      const blue = v.subarray(DIM, 2 * DIM);
      expect(dot(red, red)).toBeCloseTo(1, 4); // unit vectors
      const saysRed = await model.text('a red square');
      const saysBlue = await model.text('a blue square');
      expect(dot(red, saysRed)).toBeGreaterThan(dot(red, saysBlue));
      expect(dot(blue, saysBlue)).toBeGreaterThan(dot(blue, saysRed));
    } finally {
      await model.close();
    }
  });
});
