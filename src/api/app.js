import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookback } from '../lookback/lookback.js';
import { simulate } from '../portfolio/simulate.js';
import { describeUniverse } from '../returns/universe.js';
import { ValidationError, validateLookback, validateSimulate } from './validate.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const MAX_BODY = 1024 * 1024;

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ValidationError('body', 'larger than 1 MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new ValidationError('body', 'is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Request handler over a prepared universe (built once at startup).
export function createApp(universe) {
  const assetsInfo = describeUniverse(universe);
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.writeHead(200, { 'content-type': type });
        res.end(readFileSync(path.join(PUBLIC_DIR, file)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/assets') return send(res, 200, assetsInfo);
      if (req.method === 'POST' && url.pathname === '/api/simulate') {
        const config = validateSimulate(await readJson(req), universe);
        return send(res, 200, simulate(universe, config));
      }
      if (req.method === 'POST' && url.pathname === '/api/lookback') {
        const { config, options } = validateLookback(await readJson(req), universe);
        const result = lookback(universe, config, options);
        return send(res, 200, { config, ...result });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { error: e.message, field: e.field });
      if (e instanceof RangeError) return send(res, 400, { error: e.message, field: 'start' });
      return send(res, 500, { error: 'internal error' });
    }
  };
}

export function createAppServer(universe) {
  return createServer(createApp(universe));
}
