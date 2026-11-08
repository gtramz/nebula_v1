import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Keep the real authentication rate limit intact. Each specification gets a new
// disposable server/database rather than sharing one registration budget with
// the entire growing suite. No review data or product configuration is changed.
const [suite, ...args] = process.argv.slice(2);
if (!['shared', 'collaborations', 'remix'].includes(suite)) throw new Error('Choose shared, collaborations or remix.');
const config = `playwright.${suite}.config.ts`;
const files = (await readdir(`tests-${suite}`)).filter(name => name.endsWith('.spec.ts')).sort();
if (!files.length) throw new Error('No integrated specifications found.');
const invocations = args.length ? [args] : files.map(file => [`(^|/)${file.replaceAll('.', '\\.')}$`]);
for (const [index, filters] of invocations.entries()) {
  console.log(`\nRunning isolated ${suite}: ${filters.join(' ')}`);
  const cli = process.env.npm_execpath;
  const command = cli ? process.execPath : 'pnpm';
  const parameters = [...(cli ? [cli] : []), 'exec', 'playwright', 'test', '--config', config, ...filters, ...(args.length ? [] : ['--output', `test-results-${suite}/${files[index].replace('.spec.ts', '')}`])];
  const child = spawn(command, parameters, { stdio: 'inherit', env: process.env });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(signal ? 1 : status ?? 1));
  });
  if (code !== 0) process.exit(code);
}
