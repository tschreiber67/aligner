import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookback, windowBounds } from '../src/lookback/lookback.js';
import { distribution } from '../src/portfolio/metrics.js';
import { defaultUniverse } from '../src/returns/universe.js';
import { syntheticUniverse } from './fixtures.js';

const U = syntheticUniverse(); // 60 return months, 2000-01..2004-12
const cfg = { assets: [{ id: 'A', weight: 1 }], cash: { target: 0 } };

test('lookback: window count is N - T + 1 for N months of returns', () => {
  const r = lookback(U, cfg, { horizonMonths: 12 });
  assert.equal(r.depth.windows, 60 - 12 + 1);
  assert.equal(r.depth.firstStart, '1999-12');
  assert.equal(r.depth.lastStart, '2003-12');
  assert.equal(r.depth.lastEnd, '2004-12');
  assert.equal(r.depth.overlapping, true);
});

test('lookback: from / to narrow the start months', () => {
  const r = lookback(U, cfg, { horizonMonths: 12, from: '2001-01', to: '2001-12' });
  assert.equal(r.depth.windows, 12);
  assert.equal(r.windows[0].start, '2001-01');
  assert.equal(windowBounds(U, cfg, 60).count, 1);
  assert.throws(() => lookback(U, cfg, { horizonMonths: 61 }), RangeError);
});

test('lookback: identical returns give identical outcomes in every window', () => {
  const r = lookback(U, cfg, { horizonMonths: 24 });
  assert.equal(r.outcomes.finalValue.min, r.outcomes.finalValue.max);
  assert.ok(Math.abs(r.outcomes.cagr.median - (1.01 ** 12 - 1)) < 1e-12);
  assert.equal(r.outcomes.maxDrawdown.max, 0);
});

test('distribution: min / p10 / median / p90 / max with linear interpolation', () => {
  assert.deepEqual(distribution([11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { min: 1, p10: 2, median: 6, p90: 10, max: 11 });
  const d = distribution([0, 10]);
  assert.equal(d.p10, 1);
  assert.equal(d.median, 5);
});

test('lookback: includePaths keeps T + 1 values per window', () => {
  const r = lookback(U, cfg, { horizonMonths: 6, includePaths: true });
  assert.equal(r.windows[0].path.length, 7);
  assert.equal(r.windows.length, 55);
});

test('lookback: real SPY 30-year windows start in 1871 and the depth is stated', () => {
  const u = defaultUniverse();
  const r = lookback(u, { assets: [{ id: 'SPY', weight: 1 }], cash: { target: 0 } }, { horizonMonths: 360 });
  assert.equal(r.depth.firstStart, '1871-01');
  assert.equal(r.depth.windows, u.assets.SPY.series.size - 360 + 1);
  assert.deepEqual(r.depth.assetsLimitingDepth, ['SPY']);
  assert.ok(r.outcomes.cagr.min > 0, 'no 30-year S&P window lost money nominally');
});

test('lookback: the cash sleeve (3M bill from 1990) limits depth and is reported', () => {
  const r = lookback(defaultUniverse(), { assets: [{ id: 'SPY', weight: 0.6 }, { id: 'IEF', weight: 0.4 }] }, { horizonMonths: 120 });
  assert.equal(r.depth.firstStart, '1990-01');
  assert.deepEqual(r.depth.assetsLimitingDepth, ['CASH']);
  const again = lookback(defaultUniverse(), { assets: [{ id: 'SPY', weight: 0.6 }, { id: 'IEF', weight: 0.4 }] }, { horizonMonths: 120 });
  assert.deepEqual(again.outcomes, r.outcomes);
});
