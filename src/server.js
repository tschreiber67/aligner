import { createAppServer } from './api/app.js';
import { buildUniverse } from './returns/universe.js';

const PORT = Number(process.env.PORT) || 8113;
const HOST = '127.0.0.1';

const universe = buildUniverse(); // verifies data/s1 against its manifest first
createAppServer(universe).listen(PORT, HOST, () => {
  console.log(`Portfolio planner on http://${HOST}:${PORT} (packs: ${universe.packs.map((p) => p.name).join(', ')})`);
});
