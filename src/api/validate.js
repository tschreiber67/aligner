import { isMonthKey } from '../data/months.js';

export class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.field = field;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

function numberField(body, key, { min, max, integer = false, required = false, def, field = key }) {
  const v = body[key];
  if (v === undefined) {
    if (required) throw new ValidationError(field, 'is required');
    return def;
  }
  if (!num(v)) throw new ValidationError(field, 'must be a number');
  if (integer && !Number.isInteger(v)) throw new ValidationError(field, 'must be an integer');
  if (v < min || v > max) throw new ValidationError(field, `must be between ${min} and ${max}`);
  return v;
}

function boolField(body, field, def) {
  const v = body[field];
  if (v === undefined) return def;
  if (typeof v !== 'boolean') throw new ValidationError(field, 'must be true or false');
  return v;
}

// Shared portfolio fields of /api/simulate and /api/lookback. Returns a normalised config.
export function validatePortfolio(body, universe) {
  if (!isObj(body)) throw new ValidationError('body', 'must be a JSON object');
  const { assets } = body;
  if (!Array.isArray(assets) || assets.length === 0) throw new ValidationError('assets', 'must be a non-empty array');
  if (assets.length > 10) throw new ValidationError('assets', 'at most 10 assets');
  const seen = new Set();
  const out = assets.map((a, i) => {
    const f = `assets[${i}]`;
    if (!isObj(a)) throw new ValidationError(f, 'must be an object');
    if (typeof a.id !== 'string' || !universe.assets[a.id]) {
      throw new ValidationError(`${f}.id`, `unknown asset; known: ${Object.keys(universe.assets).join(', ')}`);
    }
    if (seen.has(a.id)) throw new ValidationError(`${f}.id`, 'listed twice');
    seen.add(a.id);
    const weight = numberField(a, 'weight', { min: 0, max: 1, required: true, field: `${f}.weight` });
    const expenseRatio = numberField(a, 'expenseRatio', { min: 0, max: 0.05, def: 0, field: `${f}.expenseRatio` });
    return { id: a.id, weight, expenseRatio };
  });
  const sum = out.reduce((s, a) => s + a.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) throw new ValidationError('assets', `weights must sum to 1 (got ${sum.toFixed(6)})`);

  const rebalance = body.rebalance === undefined ? {} : body.rebalance;
  if (!isObj(rebalance)) throw new ValidationError('rebalance', 'must be an object');
  const frequency = rebalance.frequency ?? 'annual';
  if (!['none', 'annual', 'quarterly'].includes(frequency)) {
    throw new ValidationError('rebalance.frequency', 'must be none, annual or quarterly');
  }
  const month = rebalance.month ?? 12;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new ValidationError('rebalance.month', 'must be an integer 1-12');

  const cash = body.cash === undefined ? {} : body.cash;
  if (!isObj(cash)) throw new ValidationError('cash', 'must be an object');
  const target = cash.target ?? 0.1;
  if (!num(target) || target < 0 || target > 0.9) throw new ValidationError('cash.target', 'must be a number between 0 and 0.9');
  const cashAsset = cash.asset ?? 'CASH';
  if (!['CASH', 'NONE'].includes(cashAsset)) throw new ValidationError('cash.asset', 'must be CASH or NONE');

  return {
    assets: out,
    startValue: numberField(body, 'startValue', { min: 1, max: 1e12, def: 10000 }),
    monthlyContribution: numberField(body, 'monthlyContribution', { min: 0, max: 1e9, def: 0 }),
    drip: boolField(body, 'drip', true),
    rebalance: { frequency, month },
    cash: { target, asset: cashAsset },
    inflationAdjusted: boolField(body, 'inflationAdjusted', false),
  };
}

export function validateSimulate(body, universe) {
  const config = validatePortfolio(body, universe);
  if (!isMonthKey(body.start)) throw new ValidationError('start', 'must be a month YYYY-MM');
  config.start = body.start;
  config.months = numberField(body, 'months', { min: 1, max: 1200, integer: true, required: true });
  return config;
}

export function validateLookback(body, universe) {
  const config = validatePortfolio(body, universe);
  const horizonMonths = numberField(body, 'horizonMonths', { min: 1, max: 1200, integer: true, required: true });
  for (const f of ['from', 'to']) {
    if (body[f] !== undefined && body[f] !== null && !isMonthKey(body[f])) throw new ValidationError(f, 'must be a month YYYY-MM');
  }
  return { config, options: { horizonMonths, from: body.from ?? null, to: body.to ?? null } };
}
