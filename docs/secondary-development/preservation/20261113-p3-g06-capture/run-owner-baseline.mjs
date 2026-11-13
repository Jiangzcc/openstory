import { readFile, writeFile, unlink, access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const sourceBefore = '9d14dd318035a0b62b3675673a0675a623835c89';
const dir = '.tmp/p3-g06-capture-20261113';
await mkdir(dir, { recursive: true });
const entries = {
  web: {
    owner: 'src/sequences/sequences.fn.ts',
    test: 'src/sequences/server/sequence-creation-entry.test.ts',
    aliasOwner: 'src/sequences/g06-sequences-baseline.tmp.fn.ts',
    aliasTest: 'src/sequences/server/g06-web-baseline.tmp.test.ts',
    from: "await import('../sequences.fn')",
    to: "await import('../g06-sequences-baseline.tmp.fn')",
  },
  core: {
    owner: 'src/sequences/server/create-sequences.ts',
    test: 'src/sequences/server/sequence-creation-capture.test.ts',
    aliasOwner: 'src/sequences/server/g06-create-sequences-baseline.tmp.ts',
    aliasTest: 'src/sequences/server/g06-core-baseline.tmp.test.ts',
    from: "await import('./create-sequences')",
    to: "await import('./g06-create-sequences-baseline.tmp')",
  },
  api: {
    owner: 'src/platform/server/api-v1/create.ts',
    test: 'src/platform/server/api-v1/sequence-creation-capture.test.ts',
    aliasOwner: 'src/platform/server/api-v1/g06-create-baseline.tmp.ts',
    aliasTest: 'src/platform/server/api-v1/g06-api-baseline.tmp.test.ts',
    from: "await import('./create')",
    to: "await import('./g06-create-baseline.tmp')",
  },
};
const name = process.argv[2],
  entry = entries[name];
if (!entry) throw new Error('Expected web/core/api');
const hash = (b) => createHash('sha256').update(b).digest('hex');
for (const file of [entry.aliasOwner, entry.aliasTest])
  if (
    await access(file).then(
      () => true,
      () => false
    )
  )
    throw new Error('Refusing overwrite ' + file);
const before = await readFile(entry.owner);
const source = execFileSync('git', ['show', sourceBefore + ':' + entry.owner], {
  encoding: 'utf8',
});
const probe = await readFile(entry.test, 'utf8');
if (probe.split(entry.from).length !== 2)
  throw new Error('Expected unique owner import');
const redirected = probe.replace(entry.from, entry.to),
  prefix = dir + '/' + name + '-baseline-final';
try {
  await writeFile(entry.aliasOwner, source);
  await writeFile(entry.aliasTest, redirected);
  const run = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url)
      ),
      'run',
      entry.aliasTest,
      '--maxWorkers=1',
      '--reporter=default',
      '--reporter=json',
      '--outputFile=' + prefix + '.json',
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  await writeFile(prefix + '.log', run.stdout + run.stderr);
  if (run.error) throw run.error;
  const report = JSON.parse(await readFile(prefix + '.json', 'utf8'));
  const unchanged = hash(before) === hash(await readFile(entry.owner));
  const failures = report.testResults.flatMap((s) =>
    s.assertionResults
      .filter((a) => a.status === 'failed')
      .map((a) => ({ title: a.fullName, messages: a.failureMessages }))
  );
  const meta = {
    sourceBefore,
    name,
    ...entry,
    ownerSourceSha256: hash(source),
    finalProbeSha256: hash(probe),
    redirectedProbeSha256: hash(redirected),
    onlyOwnerImportRedirected: true,
    productionWorkingFileUnchanged: unchanged,
    exitCode: run.status,
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    failures,
  };
  await writeFile(prefix + '-meta.json', JSON.stringify(meta, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify(
      { ...meta, failures: failures.map((f) => f.title) },
      null,
      2
    ) + '\n'
  );
  if (
    !unchanged ||
    run.status !== 1 ||
    report.numFailedTests === 0 ||
    report.numPendingTests !== 0
  )
    process.exitCode = 1;
} finally {
  for (const file of [entry.aliasTest, entry.aliasOwner])
    await unlink(file).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
}
