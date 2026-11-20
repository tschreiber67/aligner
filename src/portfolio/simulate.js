import { addMonths, calendarMonth, monthIndex, monthFromIndex } from '../data/months.js';
import { toReal } from '../returns/proxies.js';
import { maxDrawdown, annualisedVolatility, irrAnnual } from './metrics.js';

export const DEFAULTS = Object.freeze({
  startValue: 10000,
  monthlyContribution: 0,
  drip: true,
  rebalance: { frequency: 'annual', month: 12 },
  // Cash rule: at every rebalance (and at the start) the cash sleeve is reset to `target` of the
  // portfolio; the other assets share the rest by their weights. asset 'CASH' earns the 3M bill,
  // 'NONE' earns 0%.
  cash: { target: 0.1, asset: 'CASH' },
  inflationAdjusted: false,
});

// Fill defaults. Does not validate (see src/api/validate.js for request validation).
export function withDefaults(config) {
  return {
    ...DEFAULTS,
    ...config,
    assets: config.assets.map((a) => ({ expenseRatio: 0, ...a })),
    rebalance: { ...DEFAULTS.rebalance, ...(config.rebalance ?? {}) },
    cash: { ...DEFAULTS.cash, ...(config.cash ?? {}) },
  };
}

export function isRebalanceMonth(month, rebalance) {
  const m = calendarMonth(month);
  if (rebalance.frequency === 'annual') return m === rebalance.month;
  if (rebalance.frequency === 'quarterly') return (((m - rebalance.month) % 3) + 3) % 3 === 0;
  return false;
}

// The cash sleeve earns the 3M bill when it can hold money (cash target > 0, or DRIP off) and the
// cash asset is CASH; otherwise it earns 0% nominal.
export function cashSleeveEarnsBill(config) {
  return config.cash.asset === 'CASH' && (config.cash.target > 0 || !config.drip);
}

// Months (returns) every input series covers: [first, last] where all assets (and the cash asset,
// and inflation when inflation-adjusted) have a return. Returns null if there is no overlap.
export function commonRange(universe, config) {
  const ids = config.assets.map((a) => a.id);
  if (cashSleeveEarnsBill(config) && !ids.includes('CASH')) ids.push('CASH');
  let first = -Infinity;
  let last = Infinity;
  for (const id of ids) {
    const a = universe.assets[id];
    if (!a) throw new Error(`unknown asset ${id}`);
    first = Math.max(first, monthIndex(a.first));
    last = Math.min(last, monthIndex(a.last));
  }
  if (config.inflationAdjusted) {
    first = Math.max(first, monthIndex(universe.inflationRange.first));
    last = Math.min(last, monthIndex(universe.inflationRange.last));
  }
  if (first > last) return null;
  // Spliced series are contiguous by construction; still check every month is present.
  for (let i = first; i <= last; i++) {
    const m = monthFromIndex(i);
    for (const id of ids) if (!universe.assets[id].series.has(m)) return null;
  }
  return { first: monthFromIndex(first), last: monthFromIndex(last), ids };
}

function monthRecord(universe, id, month, real) {
  const rec = universe.assets[id].series.get(month);
  if (!rec) throw new Error(`${id} has no return for ${month}`);
  return real ? toReal(rec, universe.inflation.get(month)) : rec;
}

// Simulate a portfolio. Value at the end of `start` month is startValue; then `months` months follow.
// Month order: asset returns (net of expense ratio) -> income to cash when DRIP is off -> contribution
// split by target weights -> rebalance to targets when due.
export function simulate(universe, rawConfig, { detail = true, range: knownRange = null } = {}) {
  const config = withDefaults(rawConfig);
  const { start, months: T } = config;
  const real = !!config.inflationAdjusted;
  const range = knownRange ?? commonRange(universe, config);
  if (!range) throw new RangeError('selected assets have no common history');
  const firstStart = addMonths(range.first, -1);
  const lastStart = addMonths(range.last, -T);
  if (monthIndex(start) < monthIndex(firstStart) || monthIndex(start) > monthIndex(lastStart)) {
    throw new RangeError(`start must be between ${firstStart} and ${lastStart} for a ${T}-month horizon`);
  }
  const cashTarget = config.cash.target;
  const cashAsset = config.cash.asset;
  // CASH listed as an asset is an ordinary holding; the cash sleeve below is separate.
  const cashWeight = cashTarget;
  const targets = config.assets.map((a) => ({ id: a.id, er: a.expenseRatio, w: a.weight * (1 - cashTarget) }));

  const allocate = (amount, holdings) => {
    targets.forEach((t, i) => { holdings[i] += amount * t.w; });
    return amount * cashWeight;
  };
  let holdings = targets.map(() => 0);
  let cash = allocate(config.startValue, holdings);
  let contributed = config.startValue;
  let twr = 1;
  let dividendsToCash = 0;
  let rebalances = 0;
  let turnover = 0;
  const path = [{ month: start, value: config.startValue, contributed, cash, twr: 1 }];
  const monthlyReturns = [];
  const cashFlows = [];

  for (let k = 1; k <= T; k++) {
    const month = addMonths(start, k);
    const before = holdings.reduce((a, b) => a + b, 0) + cash;
    let income = 0;
    holdings = holdings.map((h, i) => {
      const r = monthRecord(universe, targets[i].id, month, real);
      const fee = 1 - targets[i].er / 12;
      if (config.drip) return h * (1 + r.total) * fee;
      income += h * r.income;
      return h * (1 + r.price) * fee;
    });
    const cashR = cashSleeveEarnsBill(config) ? monthRecord(universe, 'CASH', month, real).total
      : (real ? 1 / (1 + universe.inflation.get(month)) - 1 : 0);
    cash = cash * (1 + cashR) + income;
    dividendsToCash += income;
    const after = holdings.reduce((a, b) => a + b, 0) + cash;
    const ret = before > 0 ? after / before - 1 : 0;
    twr *= 1 + ret;
    monthlyReturns.push(ret);

    const c = config.monthlyContribution;
    if (c > 0) {
      cash += allocate(c, holdings);
      contributed += c;
    }
    let traded = 0;
    if (isRebalanceMonth(month, config.rebalance)) {
      const total = holdings.reduce((a, b) => a + b, 0) + cash;
      const next = targets.map((t) => total * t.w);
      const nextCash = total * cashWeight;
      traded = (next.reduce((a, v, i) => a + Math.abs(v - holdings[i]), 0) + Math.abs(nextCash - cash)) / 2;
      holdings = next;
      cash = nextCash;
      rebalances++;
      turnover += total > 0 ? traded / total : 0;
    }
    const value = holdings.reduce((a, b) => a + b, 0) + cash;
    path.push({ month, value, contributed, cash, twr });
    if (detail && (c > 0 || income > 0 || traded > 0)) {
      cashFlows.push({ month, contribution: c, dividendsToCash: income, rebalanceTraded: traded });
    }
  }

  const finalValue = path[path.length - 1].value;
  // Contributions are paid at the end of months 1..T; the final value is taken after the last one.
  const flows = [-config.startValue, ...Array.from({ length: T }, () => -config.monthlyContribution)];
  flows[T] += finalValue;
  const dd = maxDrawdown(path.map((p) => ({ month: p.month, value: p.twr })));
  const summary = {
    startMonth: start,
    endMonth: path[path.length - 1].month,
    months: T,
    inflationAdjusted: real,
    startValue: config.startValue,
    totalContributed: contributed,
    finalValue,
    gain: finalValue - contributed,
    cagr: Math.pow(twr, 12 / T) - 1,
    irr: detail ? irrAnnual(flows) : null, // skipped in lean (lookback) runs
    volatility: annualisedVolatility(monthlyReturns),
    maxDrawdown: dd,
    rebalances,
    averageTurnover: rebalances ? turnover / rebalances : 0,
    dividendsToCash,
    cashTarget,
    cashAsset,
  };
  return detail ? { config, summary, path, cashFlows } : { summary, path };
}
