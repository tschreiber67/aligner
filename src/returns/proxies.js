import { addMonths } from '../data/months.js';

// US equity proxy from Shiller monthly data: price return P_t/P_{t-1} - 1 plus income (D_t / 12) / P_{t-1}
// (Dividend is an annualised rate per month). Months with a blank price or dividend end the series there.
// rows: [{month, price, dividend}] ascending.
export function equityReturnsFromShiller(rows) {
  const out = new Map();
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (addMonths(a.month, 1) !== b.month) continue;
    if (!(a.price > 0) || !(b.price > 0) || b.dividend == null) continue;
    const price = b.price / a.price - 1;
    const income = b.dividend / 12 / a.price;
    out.set(b.month, { price, income, total: price + income });
  }
  return out;
}

// Monthly inflation from a CPI level map: cpi_t / cpi_{t-1} - 1.
export function inflationFromCpi(cpiMap) {
  const months = [...cpiMap.keys()].sort();
  const out = new Map();
  for (let i = 1; i < months.length; i++) {
    if (addMonths(months[i - 1], 1) !== months[i]) continue;
    out.set(months[i], cpiMap.get(months[i]) / cpiMap.get(months[i - 1]) - 1);
  }
  return out;
}

// Deflate one month's nominal record {total, price, income} by inflation i.
export function toReal(rec, i) {
  return {
    total: (1 + rec.total) / (1 + i) - 1,
    price: (1 + rec.price) / (1 + i) - 1,
    income: rec.income / (1 + i),
  };
}
