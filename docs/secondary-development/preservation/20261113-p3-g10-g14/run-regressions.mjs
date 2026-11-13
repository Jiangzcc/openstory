import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const files = readFileSync(new URL('./test-files.txt', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/);
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    ...files,
    '--maxWorkers=1',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
