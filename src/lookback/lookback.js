import { addMonths, isMonthKey, monthIndex, monthFromIndex } from '../data/months.js';
import { distribution } from '../portfolio/metrics.js';
import { commonRange, simulate, withDefaults } from '../portfolio/simulate.js';

// Window bounds: every start month s whose horizon s+1..s+T lies inside the common history,
// optionally narrowed to [from, to] (start months). Windows overlap and step by one month.
export function windowBounds(universe, config, horizonMonths, { from = null, to = null } = {}) {
  const cfg = withDefaults(config);
  const range = commonRange(universe, cfg);
  if (!range) throw new RangeError('selected assets have no common history');
  let lo = monthIndex(range.first) - 1;
  let hi = monthIndex(range.last) - horizonMonths;
  if (from && isMonthKey(from)) lo = Math.max(lo, monthIndex(from));
  if (to && isMonthKey(to)) hi = Math.min(hi, monthIndex(to));
  return { range, lo, hi, count: Math.max(0, hi - lo + 1) };
}

// Run the portfolio over every rolling window of `horizonMonths` and summarise outcomes.
// includePaths keeps each window's monthly value path (needed by later per-month analyses).
export function lookback(universe, config, { horizonMonths, from = null, to = null, includePaths = false } = {}) {
  const T = horizonMonths;
  const { range, lo, hi, count } = windowBounds(universe, config, T, { from, to });
  if (count === 0) {
    throw new RangeError(`no complete ${T}-month window between ${range.first} and ${range.last}`);
  }
  const windows = [];
  for (let i = lo; i <= hi; i++) {
    const start = monthFromIndex(i);
    const { summary, path } = simulate(universe, { ...config, start, months: T }, { detail: false, range });
    const w = {
      start,
      end: summary.endMonth,
      finalValue: summary.finalValue,
      totalContributed: summary.totalContributed,
      cagr: summary.cagr,
      maxDrawdown: summary.maxDrawdown.depth,
    };
    if (includePaths) w.path = path.map((p) => p.value);
    windows.push(w);
  }
  return {
    depth: {
      firstStart: windows[0].start,
      lastStart: windows[windows.length - 1].start,
      lastEnd: addMonths(windows[windows.length - 1].start, T),
      windows: windows.length,
      horizonMonths: T,
      stepMonths: 1,
      overlapping: true,
      dataFirst: range.first,
      dataLast: range.last,
      assetsLimitingDepth: range.ids.filter((id) => universe.assets[id].first === range.first),
    },
    outcomes: {
      finalValue: distribution(windows.map((w) => w.finalValue)),
      cagr: distribution(windows.map((w) => w.cagr)),
      maxDrawdown: distribution(windows.map((w) => w.maxDrawdown)),
    },
    windows,
  };
}
