// npm run data:verify [-- --data <dir>]
// Checks every data/s<n>/ pack against its manifest.json (bytes, sha256, columns, row count).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAll } from '../src/data/manifest.js';

const args = process.argv.slice(2);
const i = args.indexOf('--data');
const dataRoot = i >= 0 && args[i + 1]
  ? path.resolve(args[i + 1])
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const result = verifyAll(dataRoot);
if (result.packs.length === 0) {
  console.log('FAIL no data/s<n>/manifest.json found');
  process.exit(1);
}
let failed = 0;
for (const pack of result.packs) {
  console.log(`pack ${pack.name} (${pack.files.length} files)`);
  for (const f of pack.files) {
    if (!f.ok) failed++;
    console.log(`  ${f.ok ? 'OK  ' : 'FAIL'} ${f.path}${f.ok ? '' : `  (${f.problems.join('; ')})`}`);
  }
}
console.log(failed ? `${failed} file(s) failed` : 'all files OK');
process.exit(failed ? 1 : 0);
