// Month keys are 'YYYY-MM' strings. All date math is UTC.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isMonthKey(s) {
  return typeof s === 'string' && MONTH_RE.test(s);
}

export function monthIndex(key) {
  const m = MONTH_RE.exec(key);
  if (!m) throw new Error(`bad month key: ${key}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

export function monthFromIndex(i) {
  const y = Math.floor(i / 12);
  const m = i - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function addMonths(key, k) {
  return monthFromIndex(monthIndex(key) + k);
}

export function monthsBetween(a, b) {
  return monthIndex(b) - monthIndex(a);
}

export function monthOf(dateKey) {
  return dateKey.slice(0, 7);
}

// Calendar month number 1..12 of a month key.
export function calendarMonth(key) {
  return (monthIndex(key) % 12) + 1;
}

export function dayNumber(dateKey) {
  const m = DATE_RE.exec(dateKey);
  if (!m) throw new Error(`bad date: ${dateKey}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}

export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

// Inclusive list of month keys from a to b.
export function monthRange(a, b) {
  const out = [];
  for (let i = monthIndex(a); i <= monthIndex(b); i++) out.push(monthFromIndex(i));
  return out;
}
