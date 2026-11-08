import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Optional compiled baseline for controlled release comparisons; always disposable data.
const modulePath = resolve(process.env.NEBULA_TEST_SERVER_MODULE ?? 'dist-server/server/app.js');
const { createNebulaServer } = await import(pathToFileURL(modulePath).href);
const dataDir = await mkdtemp(join(tmpdir(), 'nebula-e2e-'));
await mkdir('.data',{recursive:true});
await writeFile('.data/e2e-data-dir',dataDir);
const server = await createNebulaServer({ dataDir, publicDir: resolve(process.env.NEBULA_TEST_PUBLIC_DIR ?? 'artifacts/nebula/dist/public') });
server.listen(4175, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(async () => { await rm(dataDir, { recursive: true, force: true }); }); server.closeAllConnections(); });
