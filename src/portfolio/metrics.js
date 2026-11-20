// Path metrics shared by the simulator and the lookback.

// Largest peak-to-trough fall of an index path [{month, value}].
// Returns {depth (negative decimal or 0), peakMonth, troughMonth, recoveryMonth (null if not recovered)}.
export function maxDrawdown(path) {
  let peak = path[0];
  let best = { depth: 0, peakMonth: path[0].month, troughMonth: path[0].month, recoveryMonth: path[0].month };
  let candidatePeak = peak;
  for (const p of path) {
    if (p.value > candidatePeak.value) candidatePeak = p;
    const depth = p.value / candidatePeak.value - 1;
    if (depth < best.depth) {
      best = { depth, peakMonth: candidatePeak.month, troughMonth: p.month, recoveryMonth: null };
      peak = candidatePeak;
    }
  }
  if (best.depth < 0) {
    const troughAt = path.findIndex((p) => p.month === best.troughMonth);
    const rec = path.slice(troughAt).find((p) => p.value >= peak.value);
    best.recoveryMonth = rec ? rec.month : null;
  }
  return best;
}

export function annualisedVolatility(monthlyReturns) {
  const n = monthlyReturns.length;
  if (n < 2) return 0;
  const m = monthlyReturns.reduce((a, b) => a + b, 0) / n;
  const v = monthlyReturns.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v) * Math.sqrt(12);
}

// Money-weighted return: monthly cash flows (negative = paid in, positive = value out),
// solved by bisection on the monthly rate, then annualised. null if no sign change.
// Uses the future value at the last month (same root as NPV, no underflow on long horizons).
export function irrAnnual(flows) {
  const T = flows.length - 1;
  const npv = (r) => flows.reduce((acc, f, t) => acc + f * Math.pow(1 + r, T - t), 0);
  let lo = -0.99;
  let hi = 0.5;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

// Linear-interpolation percentile (same as spreadsheet PERCENTILE.INC), p in [0, 1].
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

export function distribution(values) {
  const s = [...values].sort((a, b) => a - b);
  return { min: s[0], p10: percentile(s, 0.1), median: percentile(s, 0.5), p90: percentile(s, 0.9), max: s[s.length - 1] };
}
