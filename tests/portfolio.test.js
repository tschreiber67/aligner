import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maxDrawdown, irrAnnual } from '../src/portfolio/metrics.js';
import { isRebalanceMonth, simulate } from '../src/portfolio/simulate.js';
import { defaultUniverse } from '../src/returns/universe.js';
import { syntheticUniverse } from './fixtures.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const U = syntheticUniverse();
const base = { start: '2000-01', months: 12, cash: { target: 0 } };

test('simulate: one asset, no contributions compounds the monthly return', () => {
  const r = simulate(U, { ...base, assets: [{ id: 'A', weight: 1 }] });
  close(r.summary.finalValue, 10000 * 1.01 ** 12);
  close(r.summary.cagr, 1.01 ** 12 - 1, 1e-12);
  assert.equal(r.path.length, 13);
  assert.equal(r.summary.endMonth, '2001-01');
  assert.equal(r.summary.volatility, 0);
});

test('simulate: monthly contributions accumulate and a zero-return asset has IRR 0', () => {
  const r = simulate(U, { ...base, assets: [{ id: 'B', weight: 1 }], monthlyContribution: 100 });
  close(r.summary.finalValue, 11200);
  assert.equal(r.summary.totalContributed, 11200);
  close(r.summary.irr, 0, 1e-9);
  assert.equal(r.cashFlows.length, 12);
});

test('simulate: without contributions IRR equals the time-weighted CAGR', () => {
  const r = simulate(U, { ...base, months: 36, assets: [{ id: 'A', weight: 0.5 }, { id: 'B', weight: 0.5 }] });
  close(r.summary.irr, r.summary.cagr, 1e-8);
});

test('rebalance: cash is exactly 10% right after each annual rebalance and drifts between', () => {
  const r = simulate(U, { ...base, months: 24, assets: [{ id: 'A', weight: 1 }], cash: { target: 0.1 }, rebalance: { frequency: 'annual', month: 12 } });
  const at = (m) => r.path.find((p) => p.month === m);
  close(at('2000-01').cash / at('2000-01').value, 0.1, 1e-12);
  close(at('2000-12').cash / at('2000-12').value, 0.1, 1e-12);
  close(at('2001-12').cash / at('2001-12').value, 0.1, 1e-12);
  assert.ok(at('2000-06').cash / at('2000-06').value < 0.099);
  assert.equal(r.summary.rebalances, 2);
  assert.ok(r.summary.averageTurnover > 0);
});

test('rebalance: quarterly, annual and none hit the expected months', () => {
  const run = (rebalance) => simulate(U, { ...base, assets: [{ id: 'A', weight: 0.5 }, { id: 'B', weight: 0.5 }], rebalance }).summary.rebalances;
  assert.equal(run({ frequency: 'quarterly', month: 3 }), 4);
  assert.equal(run({ frequency: 'annual', month: 6 }), 1);
  assert.equal(run({ frequency: 'none', month: 12 }), 0);
  assert.equal(isRebalanceMonth('2000-11', { frequency: 'quarterly', month: 2 }), true);
  assert.equal(isRebalanceMonth('2000-10', { frequency: 'quarterly', month: 2 }), false);
});

test('rebalance: none lets weights drift; annual pulls them back', () => {
  const cfg = { ...base, months: 12, assets: [{ id: 'A', weight: 0.5 }, { id: 'B', weight: 0.5 }] };
  const drift = simulate(U, { ...cfg, rebalance: { frequency: 'none' } }).summary.finalValue;
  close(drift, 5000 * 1.01 ** 12 + 5000);
  const reb = simulate(U, { ...cfg, rebalance: { frequency: 'quarterly', month: 3 } }).summary.finalValue;
  assert.ok(reb < drift, 'rebalancing out of the faster asset gives less in a trending synthetic market');
});

test('DRIP off: income goes to the cash sleeve instead of buying more of the asset', () => {
  const r = simulate(U, { ...base, months: 1, drip: false, assets: [{ id: 'A', weight: 1 }], cash: { target: 0, asset: 'NONE' } });
  close(r.path[1].cash, 20);
  close(r.summary.finalValue, 10000 * 1.008 + 20);
  close(r.summary.dividendsToCash, 20);
  const on = simulate(U, { ...base, months: 1, assets: [{ id: 'A', weight: 1 }] });
  close(on.summary.finalValue, 10100);
});

test('expense ratio is deducted monthly (ratio / 12)', () => {
  const r = simulate(U, { ...base, assets: [{ id: 'A', weight: 1, expenseRatio: 0.012 }] });
  close(r.summary.finalValue, 10000 * (1.01 * 0.999) ** 12);
});

test('inflation-adjusted run deflates every month by CPI inflation', () => {
  const r = simulate(U, { ...base, assets: [{ id: 'A', weight: 1 }], inflationAdjusted: true });
  close(r.summary.finalValue, 10000 * (1.01 / 1.002) ** 12);
  assert.equal(r.summary.inflationAdjusted, true);
});

test('drawdown: hand example gives depth, peak, trough and recovery months', () => {
  const vals = [100, 120, 90, 100, 130, 110];
  const dd = maxDrawdown(vals.map((value, i) => ({ month: `2000-0${i + 1}`, value })));
  close(dd.depth, -0.25, 1e-12);
  assert.equal(dd.peakMonth, '2000-02');
  assert.equal(dd.troughMonth, '2000-03');
  assert.equal(dd.recoveryMonth, '2000-05');
  assert.equal(maxDrawdown([{ month: 'a', value: 1 }, { month: 'b', value: 0.5 }]).recoveryMonth, null);
});

test('irr: known flows solve to the known rate', () => {
  // pay 100, get 121 two months later -> 10% per month
  close(irrAnnual([-100, 0, 121]), 1.1 ** 12 - 1, 1e-8);
});

test('simulate: a start outside the common history is a RangeError naming the valid range', () => {
  assert.throws(() => simulate(U, { ...base, start: '2004-06', assets: [{ id: 'A', weight: 1 }] }), (e) => e instanceof RangeError && /1999-12 and 2003-12/.test(e.message));
});

test('simulate: real 60/40 SPY/IEF with 10% cash has the 2008 drawdown in the right place', () => {
  const r = simulate(defaultUniverse(), { start: '2000-01', months: 240, assets: [{ id: 'SPY', weight: 0.6 }, { id: 'IEF', weight: 0.4 }] });
  const dd = r.summary.maxDrawdown;
  assert.ok(dd.depth < -0.15 && dd.depth > -0.35, String(dd.depth));
  assert.ok(dd.troughMonth >= '2008-10' && dd.troughMonth <= '2009-03', dd.troughMonth);
  assert.equal(r.summary.rebalances, 20);
});
