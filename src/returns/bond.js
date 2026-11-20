// Par-bond math for building Treasury fund proxies from constant-maturity yields.
// Rates are decimals (0.05 = 5%). Semiannual coupons by default.

// Price per 100 face of a bond paying annual coupon rate `coupon`, priced at yield `y`,
// with `years` to maturity (fractional periods allowed: standard annuity formula with n = years * freq).
export function bondPrice(coupon, y, years, freq = 2) {
  if (!(years >= 0)) throw new Error('years must be >= 0');
  const n = years * freq;
  const c = (100 * coupon) / freq;
  if (Math.abs(y) < 1e-12) return c * n + 100;
  const r = y / freq;
  const disc = Math.pow(1 + r, -n);
  return (c * (1 - disc)) / r + 100 * disc;
}

// One month of holding a par bond bought at yield y0 (so coupon = y0), repriced one month later at y1
// with maturity - 1/12 years left. Returns {income, price, total} as decimals.
// Yield unchanged -> price return 0 and total = y0 / 12.
export function parBondMonthReturn(y0, y1, maturityYears, freq = 2) {
  const income = y0 / 12;
  const price = bondPrice(y0, y1, maturityYears - 1 / 12, freq) / 100 - 1;
  return { income, price, total: income + price };
}

// Monthly returns from a month -> yield (percent) map: constant-maturity fund rolled monthly.
export function bondReturnsFromYields(yieldMap, maturityYears) {
  const months = [...yieldMap.keys()].sort();
  const out = new Map();
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1];
    const cur = months[i];
    if (!consecutive(prev, cur)) continue;
    out.set(cur, parBondMonthReturn(yieldMap.get(prev) / 100, yieldMap.get(cur) / 100, maturityYears));
  }
  return out;
}

// Cash (T-bill) monthly return: previous month-end yield / 12, all income.
export function cashReturnsFromYields(yieldMap) {
  const months = [...yieldMap.keys()].sort();
  const out = new Map();
  for (let i = 1; i < months.length; i++) {
    if (!consecutive(months[i - 1], months[i])) continue;
    const r = yieldMap.get(months[i - 1]) / 100 / 12;
    out.set(months[i], { income: r, price: 0, total: r });
  }
  return out;
}

function consecutive(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return yb * 12 + mb - (ya * 12 + ma) === 1;
}
