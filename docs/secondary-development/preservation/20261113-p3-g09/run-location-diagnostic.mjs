import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = resolve(
  execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
);
const relativeTarget = 'src/cast/server/db/p3-g09-location-diagnostic.test.ts';
const target = resolve(root, relativeTarget);
if (!target.startsWith(root + sep))
  throw new Error('Diagnostic target escaped the repository');
const source = readFileSync(
  new URL('./location-ownership-contract.test.ts.txt', import.meta.url)
);
// Exclusive creation protects an existing file; only this created file is removed.
writeFileSync(target, source, { flag: 'wx' });
let result;
try {
  result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      relativeTarget,
      '--maxWorkers=1',
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: 'inherit' }
  );
} finally {
  unlinkSync(target);
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
