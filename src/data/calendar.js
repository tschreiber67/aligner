import { addMonths, daysBetween, monthOf, monthRange } from './months.js';

export const DEFAULT_MAX_FILL_DAYS = 7;

// Align a daily series to month ends (last trading day of each calendar month).
// points: [{date:'YYYY-MM-DD', value:number|null}] in ascending date order.
// A blank value on the last trading day is filled from the latest valid value only if that value
// is at most maxFillDays calendar days older; otherwise the month is null and listed in `missing`.
// `gaps` lists every stretch between consecutive valid observations longer than maxFillDays.
// The final month is dropped (listed in `partial`) when its last row is more than maxFillDays before
// the calendar month end: a month that has not finished has no month-end value yet.
export function toMonthEnd(points, { maxFillDays = DEFAULT_MAX_FILL_DAYS } = {}) {
  const months = [];
  const gaps = [];
  const missing = [];
  const filled = [];
  const partial = [];
  if (points.length === 0) return { months, gaps, missing, filled, partial };
  const byMonth = new Map();
  let prevValid = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0 && p.date <= points[i - 1].date) throw new Error(`dates not ascending at ${p.date}`);
    if (p.value != null && Number.isFinite(p.value)) {
      if (prevValid && daysBetween(prevValid.date, p.date) > maxFillDays) {
        gaps.push({ from: prevValid.date, to: p.date, days: daysBetween(prevValid.date, p.date) });
      }
      prevValid = p;
    }
    byMonth.set(monthOf(p.date), { last: p, lastValid: prevValid });
  }
  const first = monthOf(points[0].date);
  const lastDate = points[points.length - 1].date;
  let last = monthOf(lastDate);
  if (daysBetween(lastDate, lastDayOfMonth(last)) > maxFillDays) {
    partial.push(last);
    if (last === first) return { months, gaps, missing, filled, partial };
    last = addMonths(last, -1);
  }
  for (const month of monthRange(first, last)) {
    const rec = byMonth.get(month);
    if (!rec) {
      months.push({ month, date: null, value: null });
      missing.push(month);
      continue;
    }
    const { last: row, lastValid } = rec;
    if (row.value != null && Number.isFinite(row.value)) {
      months.push({ month, date: row.date, value: row.value });
    } else if (lastValid && daysBetween(lastValid.date, row.date) <= maxFillDays) {
      months.push({ month, date: row.date, value: lastValid.value, filledFrom: lastValid.date });
      filled.push(month);
    } else {
      months.push({ month, date: row.date, value: null });
      missing.push(month);
    }
  }
  return { months, gaps, missing, filled, partial };
}

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

// Monthly files with dates like 'YYYY-MM-01': month key -> value (nulls dropped).
export function monthlyMap(rows, dateCol, valueCol) {
  const out = new Map();
  for (const r of rows) {
    const v = r[valueCol];
    if (v != null && Number.isFinite(v)) out.set(monthOf(r[dateCol]), v);
  }
  return out;
}

// Aligned month-end result -> Map month -> value (missing months dropped).
export function monthEndMap(aligned) {
  const out = new Map();
  for (const m of aligned.months) if (m.value != null) out.set(m.month, m.value);
  return out;
}
