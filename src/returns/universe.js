import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monthEndMap, monthlyMap, toMonthEnd } from '../data/calendar.js';
import { discoverPacks, openPack } from '../data/manifest.js';
import { monthOf } from '../data/months.js';
import { bondReturnsFromYields, cashReturnsFromYields } from './bond.js';
import { equityReturnsFromShiller, inflationFromCpi } from './proxies.js';
import { splice } from './splice.js';
import { fundMonthly } from './totalReturn.js';

export const DEFAULT_DATA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

// Asset catalogue for the S1 pack. proxy: which long-history series stands in before the fund's first month.
export const ASSETS = [
  { id: 'SPY', label: 'S&P 500 ETF', kind: 'equity', proxy: 'shiller-equity' },
  { id: 'QQQ', label: 'Nasdaq-100 ETF', kind: 'equity', proxy: null },
  { id: 'AGG', label: 'US aggregate bond ETF', kind: 'bond', proxy: 'ust-5y-par' },
  { id: 'BND', label: 'US total bond ETF', kind: 'bond', proxy: 'ust-5y-par' },
  { id: 'TLT', label: '20+ year Treasury ETF', kind: 'bond', proxy: 'ust-20y-par' },
  { id: 'IEF', label: '7-10 year Treasury ETF', kind: 'bond', proxy: 'ust-10y-par-h15' },
  { id: 'SHY', label: '1-3 year Treasury ETF', kind: 'bond', proxy: 'ust-2y-par' },
  { id: 'CASH', label: '3-month Treasury bill', kind: 'cash', proxy: null },
];

export const PROXY_NOTES = {
  'shiller-equity': 'Shiller S&P composite: monthly average price plus Dividend/12',
  'ust-5y-par': '5-year constant-maturity par bond from the daily Treasury curve (month-end yield)',
  'ust-20y-par': '20-year constant-maturity par bond from the daily Treasury curve (month-end yield)',
  'ust-10y-par-h15': '10-year constant-maturity par bond from Fed H.15 monthly 10-year yield',
  'ust-2y-par': '2-year constant-maturity par bond from the daily Treasury curve (month-end yield)',
};

function curveMonthEnd(rows, tenor) {
  return toMonthEnd(rows.map((r) => ({ date: r.date, value: r[tenor] })));
}

// Build every asset's monthly return series from the S1 pack (verified against its manifest).
export function buildUniverse({ dataRoot = DEFAULT_DATA_ROOT, verify = true } = {}) {
  const packs = discoverPacks(dataRoot);
  const s1 = packs.find((p) => p.name === 's1');
  if (!s1) throw new Error(`no data/s1 pack under ${dataRoot}`);
  const pack = openPack(s1.dir, { verify });

  const curve = pack.read('rates/ust-par-yield-curve.daily.csv.gz').rows;
  const curveAligned = {};
  for (const t of ['3M', '2Y', '5Y', '20Y']) curveAligned[t] = curveMonthEnd(curve, t);
  const shiller = pack.read('long/shiller-sp500.monthly.csv.gz').rows.map((r) => ({
    month: monthOf(r.Date), price: r.SP500, dividend: r.Dividend,
  }));
  const h15 = monthlyMap(pack.read('long/ust10y.monthly.csv.gz').rows, 'Date', 'Rate');
  const cpi = monthlyMap(pack.read('macro/cpi-u-nsa.monthly.csv.gz').rows, 'date', 'value');

  const proxies = {
    'shiller-equity': equityReturnsFromShiller(shiller),
    'ust-5y-par': bondReturnsFromYields(monthEndMap(curveAligned['5Y']), 5),
    'ust-20y-par': bondReturnsFromYields(monthEndMap(curveAligned['20Y']), 20),
    'ust-10y-par-h15': bondReturnsFromYields(h15, 10),
    'ust-2y-par': bondReturnsFromYields(monthEndMap(curveAligned['2Y']), 2),
  };

  const assets = {};
  for (const def of ASSETS) {
    if (def.kind === 'cash') {
      const series = cashReturnsFromYields(monthEndMap(curveAligned['3M']));
      const months = [...series.keys()].sort();
      for (const m of months) series.get(m).source = 'yield';
      assets[def.id] = {
        ...def, series, first: months[0], last: months[months.length - 1], fundFirst: null,
        proxy: null, overlap: null, distributions: null,
        gaps: curveAligned['3M'].gaps.length, note: 'cash return = previous month-end 3M yield / 12',
      };
      continue;
    }
    const prices = pack.read(`etf/${def.id}.daily.csv.gz`).rows.map((r) => ({ date: r.date, close: r.close }));
    const dists = pack.read(`etf/${def.id}.distributions.csv.gz`).rows.map((r) => ({ date: r.date, amount: r.amount }));
    const fm = fundMonthly(prices, dists);
    const fund = new Map(fm.returns.map((r) => [r.month, { total: r.total, price: r.price, income: r.income }]));
    const sp = splice(def.proxy ? proxies[def.proxy] : null, fund);
    assets[def.id] = {
      ...def,
      series: sp.series,
      first: sp.first,
      last: sp.last,
      fundFirst: sp.fundFirst,
      proxy: def.proxy ? { name: def.proxy, note: PROXY_NOTES[def.proxy], first: sp.proxyFirst, last: sp.proxyLast } : null,
      overlap: sp.overlap,
      distributions: fm.distributions,
      gaps: fm.gaps.length,
    };
  }
  const inflation = inflationFromCpi(cpi);
  const infMonths = [...inflation.keys()].sort();
  return {
    dataRoot,
    packs: packs.map((p) => ({ name: p.name, session: p.session })),
    assets,
    inflation,
    inflationRange: { first: infMonths[0], last: infMonths[infMonths.length - 1] },
  };
}

let cached = null;
export function defaultUniverse() {
  if (!cached) cached = buildUniverse();
  return cached;
}

// Public summary for GET /api/assets (no series data).
export function describeUniverse(u) {
  return {
    packs: u.packs,
    inflation: u.inflationRange,
    assets: Object.values(u.assets).map((a) => ({
      id: a.id,
      label: a.label,
      kind: a.kind,
      first: a.first,
      last: a.last,
      months: a.series.size,
      fundFirst: a.fundFirst,
      proxy: a.proxy,
      splice: a.overlap,
      distributions: a.distributions,
      dailyGaps: a.gaps,
      note: a.note ?? null,
    })),
  };
}
