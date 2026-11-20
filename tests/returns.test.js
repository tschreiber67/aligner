import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { readCsvFile } from '../src/data/csv.js';
import { toMonthEnd } from '../src/data/calendar.js';
import { bondPrice, bondReturnsFromYields, cashReturnsFromYields, parBondMonthReturn } from '../src/returns/bond.js';
import { equityReturnsFromShiller, inflationFromCpi, toReal } from '../src/returns/proxies.js';
import { splice } from '../src/returns/splice.js';
import { dailyFundPath, fundMonthly } from '../src/returns/totalReturn.js';
import { defaultUniverse } from '../src/returns/universe.js';
import { DATA_ROOT } from './fixtures.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const etf = (t, kind) => readCsvFile(path.join(DATA_ROOT, 's1', 'etf', `${t}.${kind}.csv.gz`)).rows;

// --- month-end alignment ---

test('month-end: picks the last trading day of each month', () => {
  const r = toMonthEnd([
    { date: '2024-01-30', value: 1 }, { date: '2024-01-31', value: 2 },
    { date: '2024-02-28', value: 3 }, { date: '2024-02-29', value: 4 },
  ]);
  assert.deepEqual(r.months.map((m) => [m.month, m.date, m.value]), [['2024-01', '2024-01-31', 2], ['2024-02', '2024-02-29', 4]]);
});

test('month-end: blank last day is filled only within the fill limit', () => {
  const r = toMonthEnd([
    { date: '2024-01-29', value: 10 }, { date: '2024-01-31', value: null }, { date: '2024-02-29', value: 11 },
  ]);
  assert.equal(r.months[0].value, 10);
  assert.equal(r.months[0].filledFrom, '2024-01-29');
  assert.deepEqual(r.filled, ['2024-01']);
});

test('month-end: a gap longer than the limit is not forward-filled and is reported', () => {
  const r = toMonthEnd([
    { date: '2024-01-02', value: 5 }, { date: '2024-01-31', value: null },
    { date: '2024-02-26', value: 6 }, { date: '2024-02-29', value: 7 },
  ], { maxFillDays: 7 });
  assert.equal(r.months[0].value, null);
  assert.deepEqual(r.missing, ['2024-01']);
  assert.deepEqual(r.gaps, [{ from: '2024-01-02', to: '2024-02-26', days: 55 }]);
});

test('month-end: an unfinished final month is dropped and listed as partial', () => {
  const r = toMonthEnd([{ date: '2024-01-31', value: 1 }, { date: '2024-02-09', value: 2 }]);
  assert.deepEqual(r.months.map((m) => m.month), ['2024-01']);
  assert.deepEqual(r.partial, ['2024-02']);
});

test('month-end: real SPY closes give 120 complete months, each on its last trading day', () => {
  const rows = etf('SPY', 'daily');
  const r = toMonthEnd(rows.map((x) => ({ date: x.date, value: x.close })));
  assert.equal(r.months.length, 120);
  assert.equal(r.months[0].month, '2016-11');
  assert.equal(r.months.at(-1).month, '2026-10');
  assert.deepEqual(r.partial, ['2026-11']);
  const lastDates = new Map();
  for (const x of rows) lastDates.set(x.date.slice(0, 7), x.date);
  for (const m of r.months) assert.equal(m.date, lastDates.get(m.month));
  assert.equal(r.months.find((m) => m.month === '2020-03').date, '2020-03-31');
});

// --- total return ---

const PRICES = [
  { date: '2024-01-31', close: 100 },
  { date: '2024-02-15', close: 98 },
  { date: '2024-02-29', close: 99 },
];
const DISTS = [{ date: '2024-02-15', amount: 2 }];

test('DRIP: hand example reinvests at the ex-date close', () => {
  const on = dailyFundPath(PRICES, DISTS, { drip: true });
  close(on.days[1].shares, 1 + 2 / 98);
  close(on.days[2].value, (1 + 2 / 98) * 99);
  const off = dailyFundPath(PRICES, DISTS, { drip: false });
  assert.equal(off.days[2].value, 101);
  assert.equal(off.days[2].cash, 2);
});

test('DRIP: monthly records split total, price and income returns', () => {
  const m = fundMonthly(PRICES, DISTS);
  assert.equal(m.returns.length, 1);
  close(m.returns[0].total, ((1 + 2 / 98) * 99) / 100 - 1);
  close(m.returns[0].price, -0.01);
  close(m.returns[0].income, 0.02);
  close(m.months[1].noDrip, 1.01);
});

test('DRIP: ex-date on a non-trading day applies on the next trading day; out-of-range ones are ignored', () => {
  const r = dailyFundPath(PRICES, [
    { date: '2023-12-15', amount: 9 }, { date: '2024-02-10', amount: 1 }, { date: '2024-03-15', amount: 9 },
  ], { drip: false });
  assert.equal(r.days[1].paid, 1);
  assert.equal(r.used, 1);
  assert.equal(r.ignoredBefore, 1);
  assert.equal(r.ignoredAfter, 1);
});

test('DRIP: on real SPY the DRIP index is never below the price index and ends higher', () => {
  const m = fundMonthly(etf('SPY', 'daily').map((r) => ({ date: r.date, close: r.close })), etf('SPY', 'distributions'));
  for (const x of m.months) assert.ok(x.total >= x.price - 1e-12, x.month);
  const last = m.months.at(-1);
  assert.ok(last.total / last.price > 1.1, 'ten years of dividends add more than 10%');
  assert.ok(last.noDrip > last.price && last.noDrip < last.total);
  assert.equal(m.distributions.used, 40);
});

// --- bond math ---

test('bond: price is 100 when yield equals coupon, and matches a hand-computed price at 6%', () => {
  close(bondPrice(0.05, 0.05, 10), 100, 1e-9);
  close(bondPrice(0.05, 0.05, 9 + 11 / 12), 100, 1e-9);
  // 2.5 * (1 - 1.03^-20) / 0.03 + 100 * 1.03^-20 = 92.5613
  close(bondPrice(0.05, 0.06, 10), 92.5613, 1e-4);
});

test('bond: unchanged yield returns exactly coupon / 12', () => {
  const r = parBondMonthReturn(0.048, 0.048, 10);
  close(r.price, 0, 1e-12);
  close(r.total, 0.048 / 12, 1e-12);
});

test('bond: yield up gives a negative price return, yield down a positive one, longer maturity moves more', () => {
  const up10 = parBondMonthReturn(0.04, 0.045, 10);
  const down10 = parBondMonthReturn(0.04, 0.035, 10);
  const up2 = parBondMonthReturn(0.04, 0.045, 2);
  assert.ok(up10.price < 0 && down10.price > 0);
  assert.ok(Math.abs(up10.price) > Math.abs(up2.price) * 3);
  close(up10.price, bondPrice(0.04, 0.045, 10 - 1 / 12) / 100 - 1, 1e-12);
});

test('bond and cash series from yield maps skip non-consecutive months', () => {
  const y = new Map([['2020-01', 2], ['2020-02', 2], ['2020-04', 3]]);
  const b = bondReturnsFromYields(y, 10);
  assert.deepEqual([...b.keys()], ['2020-02']);
  close(b.get('2020-02').total, 0.02 / 12, 1e-12);
  const c = cashReturnsFromYields(y);
  close(c.get('2020-02').total, 0.02 / 12, 1e-12);
});

// --- proxies, inflation, splice ---

test('proxy: Shiller equity return = price change plus Dividend/12 over previous price', () => {
  const r = equityReturnsFromShiller([
    { month: '1900-01', price: 100, dividend: 4 },
    { month: '1900-02', price: 101, dividend: 6 },
    { month: '1900-03', price: 102, dividend: null },
  ]);
  close(r.get('1900-02').total, 0.01 + 0.5 / 100);
  assert.equal(r.has('1900-03'), false);
});

test('inflation: CPI ratio and real conversion', () => {
  const inf = inflationFromCpi(new Map([['2000-01', 100], ['2000-02', 102]]));
  close(inf.get('2000-02'), 0.02);
  const real = toReal({ total: 0.0404, price: 0.02, income: 0.0204 }, 0.02);
  close(real.total, 1.0404 / 1.02 - 1);
});

test('splice: proxy strictly before the fund start, fund after, overlap stats on shared months', () => {
  const rec = (t) => ({ total: t, price: t, income: 0 });
  const proxy = new Map([['2000-01', rec(0.01)], ['2000-02', rec(0.02)], ['2000-03', rec(-0.01)], ['2000-04', rec(0.03)], ['2000-05', rec(0.01)]]);
  const fund = new Map([['2000-04', rec(0.031)], ['2000-05', rec(0.011)], ['2000-06', rec(0)]]);
  const s = splice(proxy, fund);
  assert.deepEqual([...s.series.keys()], ['2000-01', '2000-02', '2000-03', '2000-04', '2000-05', '2000-06']);
  assert.equal(s.series.get('2000-03').source, 'proxy');
  assert.equal(s.series.get('2000-04').source, 'fund');
  assert.equal(s.series.get('2000-04').total, 0.031);
  assert.equal(s.overlap.months, 2);
  close(s.overlap.correlation, 1, 1e-9);
  assert.ok(s.overlap.trackingDifference > 0);
});

test('splice: real universe exposes proxy ranges and overlap stats for every spliced ETF', () => {
  const u = defaultUniverse();
  assert.equal(u.assets.SPY.first, '1871-02');
  assert.equal(u.assets.SPY.fundFirst, '2016-12');
  assert.equal(u.assets.IEF.first, '1953-05');
  assert.equal(u.assets.QQQ.proxy, null);
  for (const id of ['SPY', 'AGG', 'BND', 'TLT', 'IEF', 'SHY']) {
    const o = u.assets[id].overlap;
    assert.ok(o.months >= 60, id);
    assert.ok(o.correlation > 0.5, `${id} correlation ${o.correlation}`);
  }
  assert.ok(u.assets.TLT.overlap.correlation > 0.95);
});
