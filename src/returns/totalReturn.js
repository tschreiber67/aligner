import { toMonthEnd, DEFAULT_MAX_FILL_DAYS } from '../data/calendar.js';
import { monthOf } from '../data/months.js';

// Daily fund path from closes and cash distributions, starting with one share.
// DRIP on: each distribution buys shares at the ex-date close. DRIP off: it is paid to cash (no interest).
// An ex-date on a non-trading day is applied on the next trading day. Distributions outside the
// price range are ignored and counted.
export function dailyFundPath(prices, distributions, { drip = true } = {}) {
  if (prices.length === 0) throw new Error('no price rows');
  const first = prices[0].date;
  const last = prices[prices.length - 1].date;
  const dists = [...distributions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ignoredBefore = dists.filter((d) => d.date < first).length;
  const ignoredAfter = dists.filter((d) => d.date > last).length;
  const inRange = dists.filter((d) => d.date >= first && d.date <= last);
  let k = 0;
  let shares = 1;
  let cash = 0;
  const days = [];
  for (const p of prices) {
    if (!(p.close > 0)) throw new Error(`bad close on ${p.date}`);
    let paid = 0;
    while (k < inRange.length && inRange[k].date <= p.date) {
      const amount = shares * inRange[k].amount;
      paid += amount;
      if (drip) shares += amount / p.close;
      else cash += amount;
      k++;
    }
    days.push({ date: p.date, close: p.close, shares, cash, paid, value: shares * p.close + cash });
  }
  return { days, used: inRange.length, ignoredBefore, ignoredAfter };
}

// Monthly records for a fund: month-end total-return index (DRIP on), price-only index and the
// DRIP-off value index (dividends held as cash), all normalised to 1 at the first close.
// Monthly returns: total (DRIP on), price, income (cash paid in the month per share / previous month-end close).
export function fundMonthly(prices, distributions, { maxFillDays = DEFAULT_MAX_FILL_DAYS } = {}) {
  const on = dailyFundPath(prices, distributions, { drip: true });
  const off = dailyFundPath(prices, distributions, { drip: false });
  const c0 = prices[0].close;
  const idx = (days, f) => toMonthEnd(days.map((d) => ({ date: d.date, value: f(d) })), { maxFillDays });
  const total = idx(on.days, (d) => d.value / c0);
  const price = idx(on.days, (d) => d.close / c0);
  const noDrip = idx(off.days, (d) => d.value / c0);
  const paidByMonth = new Map();
  for (const d of off.days) paidByMonth.set(monthOf(d.date), (paidByMonth.get(monthOf(d.date)) ?? 0) + d.paid);
  const months = total.months.map((m, i) => ({
    month: m.month,
    date: m.date,
    total: m.value,
    price: price.months[i].value,
    noDrip: noDrip.months[i].value,
  }));
  const returns = [];
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1];
    const b = months[i];
    if (a.total == null || b.total == null) continue;
    const prevClose = a.price * c0;
    returns.push({
      month: b.month,
      total: b.total / a.total - 1,
      price: b.price / a.price - 1,
      income: (paidByMonth.get(b.month) ?? 0) / prevClose,
    });
  }
  return {
    months,
    returns,
    gaps: total.gaps,
    missing: total.missing,
    distributions: { used: on.used, ignoredBefore: on.ignoredBefore, ignoredAfter: on.ignoredAfter },
  };
}
