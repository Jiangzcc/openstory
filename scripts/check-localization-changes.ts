import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  changedPaths,
  commitSnapshot,
  repositoryRoot,
  workingSnapshot,
} from './localization/git-snapshot';
import { localizationReport } from './localization/report';

function canonicalPath(file: string): string {
  if (existsSync(file)) return realpathSync.native(file);
  const parent = dirname(file);
  return parent === file
    ? file
    : resolve(canonicalPath(parent), basename(file));
}

function writeReport(
  root: string,
  cwd: string,
  file: string,
  json: string,
  sources: ReadonlySet<string>
) {
  const output = resolve(cwd, file);
  const normalize = (file: string) => {
    const actual = canonicalPath(file);
    return process.platform === 'win32' ? actual.toLowerCase() : actual;
  };
  const inputPaths = new Set(
    [...sources].map((source) => normalize(resolve(root, source)))
  );
  if (inputPaths.has(normalize(output))) {
    throw new Error(
      'Report output would overwrite an inspected source file: ' + file
    );
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, json);
}

function options(args: string[]) {
  const result: { base: string; head?: string; out?: string } = {
    base: 'HEAD',
  };
  const allowed = new Set(['--base', '--head', '--out']);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: bun scripts/check-localization-changes.ts [--base REF] [--head REF] [--out FILE]'
      );
    }
    if (flag === '--base') result.base = value;
    if (flag === '--head') result.head = value;
    if (flag === '--out') result.out = value;
  }
  return result;
}

export function checkLocalizationChanges(cwd: string, args: string[]) {
  const input = options(args);
  const root = repositoryRoot(cwd);
  const before = commitSnapshot(root, input.base);
  const after = input.head
    ? commitSnapshot(root, input.head)
    : workingSnapshot(root);
  const files = changedPaths(
    root,
    before.revision,
    input.head ? after.revision : undefined
  );
  const report = localizationReport(before, after, files);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (input.out) {
    writeReport(
      root,
      cwd,
      input.out,
      json,
      new Set([...before.files, ...after.files])
    );
  }
  return { report, json };
}

function main() {
  try {
    const { json } = checkLocalizationChanges(
      process.cwd(),
      process.argv.slice(2)
    );
    process.stdout.write(json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
