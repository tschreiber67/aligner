import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Minimal CSV parser for the data packs: header row, comma separated, no quoted commas.
// First column (date) stays a string; empty cells become null; numeric cells become numbers.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('empty CSV');
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length !== header.length) {
      throw new Error(`line ${i + 1}: expected ${header.length} fields, got ${cells.length}`);
    }
    const row = {};
    for (let j = 0; j < header.length; j++) {
      const c = cells[j].trim();
      if (c === '') row[header[j]] = null;
      else if (j === 0) row[header[j]] = c;
      else {
        const n = Number(c);
        row[header[j]] = Number.isFinite(n) ? n : c;
      }
    }
    rows.push(row);
  }
  return { header, rows };
}

export function gunzipText(buf) {
  return gunzipSync(buf).toString('utf8');
}

export function readCsvFile(file) {
  const buf = readFileSync(file);
  const text = file.endsWith('.gz') ? gunzipText(buf) : buf.toString('utf8');
  return parseCsv(text);
}

// Count data rows (non-empty lines after the header) without building objects.
export function countDataRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}
