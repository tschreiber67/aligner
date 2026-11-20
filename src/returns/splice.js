import { addMonths } from '../data/months.js';

// Splice rule: proxy months strictly before the fund's first return month, fund months from then on.
// Only the contiguous proxy run that ends right before the fund start is used (no bridging of gaps).
// Overlap stats compare proxy and fund on every month where both exist.
// proxy, fund: Map month -> {total, price, income}.
export function splice(proxy, fund) {
  const fundMonths = [...fund.keys()].sort();
  if (fundMonths.length === 0) throw new Error('fund has no returns');
  const fundFirst = fundMonths[0];
  const series = new Map();
  let proxyFirst = null;
  let proxyLast = null;
  if (proxy) {
    let m = addMonths(fundFirst, -1);
    const run = [];
    while (proxy.has(m)) {
      run.push(m);
      m = addMonths(m, -1);
    }
    run.reverse();
    for (const k of run) series.set(k, { ...proxy.get(k), source: 'proxy' });
    if (run.length) {
      proxyFirst = run[0];
      proxyLast = run[run.length - 1];
    }
  }
  for (const k of fundMonths) series.set(k, { ...fund.get(k), source: 'fund' });
  return {
    series,
    first: proxyFirst ?? fundFirst,
    last: fundMonths[fundMonths.length - 1],
    fundFirst,
    proxyFirst,
    proxyLast,
    overlap: proxy ? overlapStats(proxy, fund) : null,
  };
}

export function overlapStats(proxy, fund) {
  const months = [...fund.keys()].filter((m) => proxy.has(m)).sort();
  const n = months.length;
  if (n < 2) return { months: n, first: months[0] ?? null, last: months[n - 1] ?? null, correlation: null, trackingDifference: null, trackingError: null };
  const f = months.map((m) => fund.get(m).total);
  const p = months.map((m) => proxy.get(m).total);
  const cagr = (xs) => Math.pow(xs.reduce((acc, r) => acc * (1 + r), 1), 12 / xs.length) - 1;
  const diff = f.map((x, i) => x - p[i]);
  return {
    months: n,
    first: months[0],
    last: months[n - 1],
    correlation: correlation(f, p),
    trackingDifference: cagr(f) - cagr(p),
    trackingError: stdev(diff) * Math.sqrt(12),
  };
}

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function correlation(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
