// Shared synthetic fixtures for tests (not a test file itself).
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { sha256 } from '../src/data/manifest.js';
import { monthRange } from '../src/data/months.js';

export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = path.join(REPO_ROOT, 'data');

const created = [];
export function tempDir(prefix = 'alloc-test-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// Remove every temp directory made by tempDir (register with node:test after()).
export function cleanup() {
  while (created.length) rmSync(created.pop(), { recursive: true, force: true });
}

// Write a tiny pack: files = {relPath: csvText}; returns its directory.
export function writePack(root, name, files, { rowsOverride = {} } = {}) {
  const dir = path.join(root, name);
  const entries = [];
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    const buf = rel.endsWith('.gz') ? gzipSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8');
    writeFileSync(file, buf);
    const lines = text.split('\n').filter((l) => l.trim());
    entries.push({
      path: rel,
      columns: lines[0].split(','),
      rows: rowsOverride[rel] ?? lines.length - 1,
      bytes: buf.length,
      sha256: sha256(buf),
    });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ pack: name, files: entries }, null, 2));
  return dir;
}

export function copyRealPack() {
  const root = tempDir();
  cpSync(path.join(DATA_ROOT, 's1'), path.join(root, 's1'), { recursive: true });
  return root;
}

// Synthetic universe: A earns 1%/month (0.8% price + 0.2% income), B earns 0, CASH 0.1%/month,
// inflation 0.2%/month, all over 2000-01..2004-12 (60 return months).
export function syntheticUniverse({ first = '2000-01', last = '2004-12' } = {}) {
  const months = monthRange(first, last);
  const mk = (rec) => new Map(months.map((m) => [m, { ...rec }]));
  const asset = (id, rec) => ({ id, label: id, kind: 'test', series: mk(rec), first, last });
  return {
    assets: {
      A: asset('A', { total: 0.01, price: 0.008, income: 0.002 }),
      B: asset('B', { total: 0, price: 0, income: 0 }),
      CASH: asset('CASH', { total: 0.001, price: 0, income: 0.001 }),
    },
    inflation: new Map(months.map((m) => [m, 0.002])),
    inflationRange: { first, last },
    packs: [],
  };
}
