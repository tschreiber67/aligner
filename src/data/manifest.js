import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { countDataRows, gunzipText, parseCsv } from './csv.js';

const PACK_RE = /^s(\d+)$/;

// Find every data/s<n>/ directory that holds a manifest.json, ordered by n.
export function discoverPacks(dataRoot) {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot)
    .map((name) => ({ name, m: PACK_RE.exec(name) }))
    .filter(({ name, m }) => m && statSync(path.join(dataRoot, name)).isDirectory()
      && existsSync(path.join(dataRoot, name, 'manifest.json')))
    .map(({ name, m }) => ({ name, session: Number(m[1]), dir: path.join(dataRoot, name) }))
    .sort((a, b) => a.session - b.session);
}

export function loadManifest(packDir) {
  const file = path.join(packDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(manifest.files)) throw new Error(`${file}: "files" array missing`);
  for (const f of manifest.files) {
    if (typeof f.path !== 'string' || f.path.split('/').includes('..') || path.isAbsolute(f.path)) {
      throw new Error(`${file}: bad file path ${JSON.stringify(f.path)}`);
    }
  }
  return manifest;
}

export function resolvePackFile(packDir, relPath) {
  return path.join(packDir, ...relPath.split('/'));
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function headerOf(text) {
  const end = text.search(/\r?\n/);
  const line = end < 0 ? text : text.slice(0, end);
  return line.replace(/^﻿/, '').split(',').map((s) => s.trim());
}

// Verify one manifest entry: file exists, byte size, sha256, header columns, data row count.
export function verifyEntry(packDir, entry) {
  const problems = [];
  const file = resolvePackFile(packDir, entry.path);
  if (!existsSync(file)) return { path: entry.path, ok: false, problems: ['missing file'] };
  const buf = readFileSync(file);
  if (entry.bytes != null && buf.length !== entry.bytes) problems.push(`bytes ${buf.length} != ${entry.bytes}`);
  if (entry.sha256 && sha256(buf) !== entry.sha256) problems.push('sha256 mismatch');
  let text = null;
  try {
    text = entry.path.endsWith('.gz') ? gunzipText(buf) : buf.toString('utf8');
  } catch (e) {
    problems.push(`cannot decompress: ${e.message}`);
  }
  if (text != null) {
    const rows = countDataRows(text);
    if (entry.rows != null && rows !== entry.rows) problems.push(`rows ${rows} != ${entry.rows}`);
    if (Array.isArray(entry.columns) && headerOf(text).join(',') !== entry.columns.join(',')) {
      problems.push('columns differ from manifest');
    }
  }
  return { path: entry.path, ok: problems.length === 0, problems };
}

export function verifyPack(packDir) {
  const manifest = loadManifest(packDir);
  const files = manifest.files.map((e) => verifyEntry(packDir, e));
  return { pack: manifest.pack ?? path.basename(packDir), dir: packDir, ok: files.every((f) => f.ok), files };
}

export function verifyAll(dataRoot) {
  const packs = discoverPacks(dataRoot).map((p) => ({ ...verifyPack(p.dir), name: p.name, session: p.session }));
  return { ok: packs.length > 0 && packs.every((p) => p.ok), packs };
}

// Open a pack: verification up front (default), then read(path) parses a manifest-listed file.
export function openPack(packDir, { verify = true } = {}) {
  const manifest = loadManifest(packDir);
  if (verify) {
    const v = verifyPack(packDir);
    if (!v.ok) {
      const bad = v.files.filter((f) => !f.ok).map((f) => `${f.path}: ${f.problems.join('; ')}`);
      throw new Error(`data pack failed verification: ${bad.join(' | ')}`);
    }
  }
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  return {
    dir: packDir,
    manifest,
    has: (rel) => listed.has(rel),
    entry: (rel) => listed.get(rel),
    read(rel) {
      if (!listed.has(rel)) throw new Error(`${rel} is not listed in the ${path.basename(packDir)} manifest`);
      const buf = readFileSync(resolvePackFile(packDir, rel));
      return parseCsv(rel.endsWith('.gz') ? gunzipText(buf) : buf.toString('utf8'));
    },
  };
}
