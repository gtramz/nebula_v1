import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNebulaServer } from '../dist-server/server/app.js';
const dataDir = await mkdtemp(join(tmpdir(), 'nebula-e2e-'));
const server = await createNebulaServer({ dataDir, publicDir: resolve(process.env.NEBULA_TEST_PUBLIC_DIR ?? 'artifacts/nebula/dist/public') });
server.listen(4175, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(async () => { await rm(dataDir, { recursive: true, force: true }); }); server.closeAllConnections(); });
