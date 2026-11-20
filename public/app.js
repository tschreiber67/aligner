const $ = (id) => document.getElementById(id);
const DEFAULT_WEIGHTS = { SPY: 60, IEF: 40 };
const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const money = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 0 });

async function loadAssets() {
  const info = await (await fetch('/api/assets')).json();
  const wBody = $('weights').querySelector('tbody');
  const aBody = $('assets').querySelector('tbody');
  for (const a of info.assets) {
    wBody.insertAdjacentHTML('beforeend', `<tr><td title="${a.label}">${a.id}</td>
      <td><input type="number" data-w="${a.id}" value="${DEFAULT_WEIGHTS[a.id] ?? 0}" min="0" max="100"></td>
      <td><input type="number" data-er="${a.id}" value="0" min="0" max="5" step="0.01"></td></tr>`);
    const s = a.splice;
    aBody.insertAdjacentHTML('beforeend', `<tr><td title="${a.proxy ? a.proxy.note : a.label}">${a.id}</td>
      <td>${a.first}</td><td>${a.fundFirst ?? '-'}</td>
      <td>${s && s.correlation != null ? s.correlation.toFixed(2) : '-'}</td>
      <td>${s && s.trackingDifference != null ? pct(s.trackingDifference, 2) : '-'}</td></tr>`);
  }
  $('packs').textContent = `Data packs: ${info.packs.map((p) => p.name).join(', ')}. CPI ${info.inflation.first} to ${info.inflation.last}. Splice stats compare proxy and fund over their overlap.`;
}

function portfolioBody() {
  const assets = [];
  for (const el of document.querySelectorAll('[data-w]')) {
    const w = Number(el.value);
    if (w > 0) {
      const er = Number(document.querySelector(`[data-er="${el.dataset.w}"]`).value) / 100;
      assets.push({ id: el.dataset.w, weight: w / 100, expenseRatio: er });
    }
  }
  return {
    assets,
    startValue: Number($('startValue').value),
    monthlyContribution: Number($('contribution').value),
    drip: $('drip').checked,
    rebalance: { frequency: $('freq').value, month: Number($('rebMonth').value) },
    cash: { target: Number($('cashTarget').value) / 100, asset: $('cashAsset').value },
    inflationAdjusted: $('real').checked,
  };
}

async function post(url, body) {
  $('err').textContent = '';
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    $('err').textContent = `${data.field ?? ''}: ${data.error}`;
    return null;
  }
  return data;
}

function drawChart(path) {
  const svg = $('chart');
  const W = 800;
  const H = 300;
  const pad = 40;
  const max = Math.max(...path.map((p) => Math.max(p.value, p.contributed)));
  const x = (i) => pad + (i / Math.max(1, path.length - 1)) * (W - pad - 10);
  const y = (v) => H - 20 - (v / max) * (H - 40);
  const line = (f) => path.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${pad}" x2="${W - 10}" y1="${y(max * t)}" y2="${y(max * t)}" stroke="#e3e6ea"/>
    <text x="2" y="${y(max * t) + 4}" font-size="10" fill="#667">${money(max * t)}</text>`).join('');
  const labels = [0, Math.floor((path.length - 1) / 2), path.length - 1]
    .map((i, j) => `<text x="${x(i)}" y="${H - 4}" font-size="10" fill="#667" text-anchor="${['start', 'middle', 'end'][j]}">${path[i].month}</text>`).join('');
  svg.innerHTML = `${ticks}${labels}
    <path d="${line((p) => p.contributed)}" fill="none" stroke="#9aa3ad" stroke-width="1.5"/>
    <path d="${line((p) => p.value)}" fill="none" stroke="#1f6fd1" stroke-width="2"/>`;
}

async function runSim() {
  const body = { ...portfolioBody(), start: $('start').value.trim(), months: Number($('months').value) };
  const r = await post('/api/simulate', body);
  if (!r) return;
  const s = r.summary;
  const rows = [
    ['Period', `${s.startMonth} to ${s.endMonth} (${s.months} months${s.inflationAdjusted ? ', real' : ''})`],
    ['Paid in', money(s.totalContributed)],
    ['Final value', money(s.finalValue)],
    ['CAGR (time-weighted)', pct(s.cagr, 2)],
    ['IRR (money-weighted)', pct(s.irr, 2)],
    ['Volatility (annualised)', pct(s.volatility, 2)],
    ['Max drawdown', `${pct(s.maxDrawdown.depth, 1)} (peak ${s.maxDrawdown.peakMonth}, trough ${s.maxDrawdown.troughMonth}, recovered ${s.maxDrawdown.recoveryMonth ?? 'not yet'})`],
    ['Rebalances / avg turnover', `${s.rebalances} / ${pct(s.averageTurnover, 1)}`],
    ['Distributions paid to cash', money(s.dividendsToCash)],
  ];
  $('summary').querySelector('tbody').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  drawChart(r.path);
}

async function runLb() {
  const from = $('from').value.trim();
  const body = { ...portfolioBody(), horizonMonths: Number($('months').value), ...(from ? { from } : {}) };
  const r = await post('/api/lookback', body);
  if (!r) return;
  const d = r.depth;
  $('depth').textContent = `${d.windows} overlapping ${d.horizonMonths}-month windows, starts ${d.firstStart} to ${d.lastStart} (data ${d.dataFirst} to ${d.dataLast}; depth limited by ${d.assetsLimitingDepth.join(', ')}).`;
  const o = r.outcomes;
  const row = (name, dist, f) => `<tr><td>${name}</td>${['min', 'p10', 'median', 'p90', 'max'].map((k) => `<td>${f(dist[k])}</td>`).join('')}</tr>`;
  $('lookback').querySelector('tbody').innerHTML = row('Final value', o.finalValue, money) + row('CAGR', o.cagr, (v) => pct(v, 2)) + row('Worst drawdown', o.maxDrawdown, (v) => pct(v, 1));
}

$('runSim').addEventListener('click', runSim);
$('runLb').addEventListener('click', runLb);
loadAssets().then(runSim).then(runLb);
