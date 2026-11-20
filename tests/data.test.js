import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { parseCsv, readCsvFile } from '../src/data/csv.js';
import { discoverPacks, loadManifest, openPack, verifyAll, verifyPack } from '../src/data/manifest.js';
import { addMonths, calendarMonth, monthRange } from '../src/data/months.js';
import { cleanup, copyRealPack, DATA_ROOT, REPO_ROOT, tempDir, writePack } from './fixtures.js';

after(cleanup);

test('csv: header, numbers, empty cells as null, date column kept as string', () => {
  const { header, rows } = parseCsv('date,close,volume\n2020-01-02,10.5,\n2020-01-03,11,200\n');
  assert.deepEqual(header, ['date', 'close', 'volume']);
  assert.deepEqual(rows[0], { date: '2020-01-02', close: 10.5, volume: null });
  assert.equal(rows[1].volume, 200);
});

test('csv: CRLF line endings and a BOM parse the same as LF', () => {
  const lf = parseCsv('date,v\n2020-01-01,1\n2020-02-01,2\n');
  const crlf = parseCsv('﻿date,v\r\n2020-01-01,1\r\n2020-02-01,2\r\n');
  assert.deepEqual(crlf, lf);
});

test('csv: a row with the wrong field count names the line', () => {
  assert.throws(() => parseCsv('date,a,b\n2020-01-01,1,2\n2020-01-02,1\n'), /line 3/);
});

test('csv: gzip file round trip through readCsvFile', () => {
  const dir = tempDir();
  const file = path.join(dir, 'x.csv.gz');
  writeFileSync(file, gzipSync(Buffer.from('date,amount\n2021-03-01,0.25\n')));
  assert.deepEqual(readCsvFile(file).rows, [{ date: '2021-03-01', amount: 0.25 }]);
});

test('csv: real SPY daily file has 2513 rows from 2016-11-09', () => {
  const { header, rows } = readCsvFile(path.join(DATA_ROOT, 's1', 'etf', 'SPY.daily.csv.gz'));
  assert.deepEqual(header, ['date', 'open', 'high', 'low', 'close', 'volume']);
  assert.equal(rows.length, 2513);
  assert.equal(rows[0].date, '2016-11-09');
});

test('months: arithmetic across year ends and inclusive ranges', () => {
  assert.equal(addMonths('1999-11', 3), '2000-02');
  assert.equal(addMonths('2000-01', -1), '1999-12');
  assert.deepEqual(monthRange('2019-11', '2020-02'), ['2019-11', '2019-12', '2020-01', '2020-02']);
  assert.equal(calendarMonth('2024-12'), 12);
});

test('verify: the shipped data/s1 pack passes every manifest check', () => {
  const v = verifyPack(path.join(DATA_ROOT, 's1'));
  assert.equal(v.files.length, 19);
  assert.deepEqual(v.files.filter((f) => !f.ok), []);
  assert.equal(v.ok, true);
});

test('verify: one tampered byte fails the sha256 check', () => {
  const root = copyRealPack();
  const file = path.join(root, 's1', 'macro', 'cpi-u-nsa.monthly.csv.gz');
  const buf = readFileSync(file);
  buf[buf.length - 20] ^= 0xff;
  writeFileSync(file, buf);
  const v = verifyPack(path.join(root, 's1'));
  assert.equal(v.ok, false);
  const bad = v.files.find((f) => f.path === 'macro/cpi-u-nsa.monthly.csv.gz');
  assert.ok(bad.problems.includes('sha256 mismatch'));
  assert.equal(v.files.filter((f) => !f.ok).length, 1);
});

test('verify: a manifest row count that does not match the file is reported', () => {
  const root = tempDir();
  const dir = writePack(root, 's1', { 'a.csv.gz': 'date,v\n2020-01-01,1\n2020-02-01,2\n' }, { rowsOverride: { 'a.csv.gz': 3 } });
  const v = verifyPack(dir);
  assert.equal(v.ok, false);
  assert.match(v.files[0].problems.join(), /rows 2 != 3/);
});

test('verify: a missing file is reported', () => {
  const root = tempDir();
  const dir = writePack(root, 's1', { 'a.csv.gz': 'date,v\n2020-01-01,1\n' });
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.files.push({ ...m.files[0], path: 'gone.csv.gz' });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  const v = verifyPack(dir);
  assert.deepEqual(v.files.find((f) => f.path === 'gone.csv.gz').problems, ['missing file']);
});

test('packs: discovers every data/s<n>/ with a manifest, in session order', () => {
  const root = tempDir();
  writePack(root, 's10', { 'x.csv': 'date,v\n2020-01-01,1\n' });
  writePack(root, 's2', { 'x.csv': 'date,v\n2020-01-01,1\n' });
  writePack(root, 's1', { 'x.csv': 'date,v\n2020-01-01,1\n' });
  mkdirSync(path.join(root, 's3')); // no manifest: ignored
  mkdirSync(path.join(root, 'scratch'));
  assert.deepEqual(discoverPacks(root).map((p) => p.name), ['s1', 's2', 's10']);
  assert.equal(verifyAll(root).ok, true);
});

test('packs: openPack reads listed files only and refuses a tampered pack', () => {
  const root = tempDir();
  const dir = writePack(root, 's2', { 'etf/X.daily.csv.gz': 'date,close\n2020-01-02,5\n' });
  const pack = openPack(dir);
  assert.equal(pack.read('etf/X.daily.csv.gz').rows[0].close, 5);
  assert.throws(() => pack.read('etf/Y.daily.csv.gz'), /not listed/);
  writeFileSync(path.join(dir, 'etf', 'X.daily.csv.gz'), gzipSync(Buffer.from('date,close\n2020-01-02,6\n')));
  assert.throws(() => openPack(dir), /failed verification/);
});

test('packs: manifest paths that escape the pack are rejected', () => {
  const root = tempDir();
  const dir = writePack(root, 's1', { 'a.csv': 'date,v\n2020-01-01,1\n' });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ files: [{ path: '../outside.csv' }] }));
  assert.throws(() => loadManifest(dir), /bad file path/);
});

test('data:verify script exits 0 on the shipped pack and 1 on a tampered copy', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'verify-data.js');
  const ok = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /all files OK/);
  const root = copyRealPack();
  const file = path.join(root, 's1', 'etf', 'TLT.distributions.csv.gz');
  const buf = readFileSync(file);
  buf[10] ^= 0x01;
  writeFileSync(file, buf);
  const bad = spawnSync(process.execPath, [script, '--data', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL etf\/TLT\.distributions\.csv\.gz/);
});
