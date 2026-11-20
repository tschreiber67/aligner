import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAppServer } from '../src/api/app.js';
import { defaultUniverse } from '../src/returns/universe.js';

let server;
let baseUrl;

before(async () => {
  server = createAppServer(defaultUniverse());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = async (url, body) => {
  const res = await fetch(baseUrl + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const SIM = { assets: [{ id: 'SPY', weight: 0.6 }, { id: 'IEF', weight: 0.4 }], start: '2000-01', months: 120 };

test('GET /api/assets lists every asset with ranges and splice stats', async () => {
  const res = await fetch(`${baseUrl}/api/assets`);
  assert.equal(res.status, 200);
  const info = await res.json();
  assert.deepEqual(info.assets.map((a) => a.id), ['SPY', 'QQQ', 'AGG', 'BND', 'TLT', 'IEF', 'SHY', 'CASH']);
  const spy = info.assets[0];
  assert.equal(spy.first, '1871-02');
  assert.equal(spy.proxy.name, 'shiller-equity');
  assert.ok(spy.splice.months > 0 && typeof spy.splice.correlation === 'number');
  assert.deepEqual(info.packs.map((p) => p.name), ['s1']);
});

test('POST /api/simulate returns summary, path and cash flows', async () => {
  const { status, body } = await post('/api/simulate', { ...SIM, monthlyContribution: 200 });
  assert.equal(status, 200);
  assert.equal(body.path.length, 121);
  assert.equal(body.summary.totalContributed, 10000 + 200 * 120);
  assert.equal(body.summary.cashTarget, 0.1);
  assert.ok(body.summary.finalValue > 0);
});

test('POST /api/lookback returns depth and outcome distributions', async () => {
  const { status, body } = await post('/api/lookback', { assets: SIM.assets, horizonMonths: 120, from: '2000-01' });
  assert.equal(status, 200);
  assert.equal(body.depth.firstStart, '2000-01');
  assert.equal(body.depth.windows, body.windows.length);
  for (const k of ['finalValue', 'cagr', 'maxDrawdown']) assert.ok(body.outcomes[k].p10 <= body.outcomes[k].p90);
});

const cases = [
  ['missing assets', { start: '2000-01', months: 12 }, 'assets'],
  ['weights not summing to 1', { ...SIM, assets: [{ id: 'SPY', weight: 0.5 }] }, 'assets'],
  ['unknown asset', { ...SIM, assets: [{ id: 'XYZ', weight: 1 }] }, 'assets[0].id'],
  ['negative weight', { ...SIM, assets: [{ id: 'SPY', weight: -0.5 }, { id: 'IEF', weight: 1.5 }] }, 'assets[0].weight'],
  ['bad start format', { ...SIM, start: '2000-13' }, 'start'],
  ['non-integer months', { ...SIM, months: 12.5 }, 'months'],
  ['start before QQQ history', { ...SIM, assets: [{ id: 'QQQ', weight: 1 }], start: '1995-01' }, 'start'],
  ['bad rebalance frequency', { ...SIM, rebalance: { frequency: 'weekly' } }, 'rebalance.frequency'],
  ['cash target above 0.9', { ...SIM, cash: { target: 0.95 } }, 'cash.target'],
  ['drip not boolean', { ...SIM, drip: 'yes' }, 'drip'],
];
for (const [name, body, field] of cases) {
  test(`POST /api/simulate 400: ${name} names field ${field}`, async () => {
    const r = await post('/api/simulate', body);
    assert.equal(r.status, 400);
    assert.equal(r.body.field, field);
    assert.ok(r.body.error.length > 0);
  });
}

test('POST /api/simulate 400 on invalid JSON', async () => {
  const r = await post('/api/simulate', '{not json');
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'body');
});

test('POST /api/lookback 400 without horizonMonths', async () => {
  const r = await post('/api/lookback', { assets: SIM.assets });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'horizonMonths');
});

test('GET / serves the planner page and unknown routes are 404', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Portfolio Planner/);
  const js = await fetch(`${baseUrl}/app.js`);
  assert.equal(js.status, 200);
  await js.text();
  const nf = await fetch(`${baseUrl}/api/nope`);
  assert.equal(nf.status, 404);
  await nf.text();
});
