import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SourceSnapshot = {
  revision: string;
  files: ReadonlySet<string>;
  read: (file: string) => string;
};
const SOURCE_ROOTS = ['src', 'docs'];
const GIT_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;

function git(root: string, args: string[]) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function repositoryRoot(cwd: string) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function commitSnapshot(root: string, ref: string): SourceSnapshot {
  const revision = git(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    ref + '^{commit}',
  ]).trim();
  const files = new Set(
    git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      revision,
      '--',
      ...SOURCE_ROOTS,
    ])
      .split('\0')
      .filter(Boolean)
  );
  return {
    revision,
    files,
    read: (file) => git(root, ['show', revision + ':' + file]),
  };
}

export function workingSnapshot(root: string): SourceSnapshot {
  const tracked = git(root, ['ls-files', '-z', '--', ...SOURCE_ROOTS]);
  const untracked = git(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...SOURCE_ROOTS,
  ]);
  const files = new Set(
    (tracked + untracked)
      .split('\0')
      .filter((file) => file && existsSync(resolve(root, file)))
  );
  return {
    revision: 'working-tree',
    files,
    read: (file) => readFileSync(resolve(root, file), 'utf8'),
  };
}

export function changedPaths(root: string, base: string, head?: string) {
  const revisions = head === undefined ? [base] : [base, head];
  const changed = git(root, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    ...revisions,
    '--',
    ...SOURCE_ROOTS,
  ]);
  const added =
    head === undefined
      ? git(root, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
          '--',
          ...SOURCE_ROOTS,
        ])
      : '';
  return [...new Set((changed + added).split('\0').filter(Boolean))].sort();
}
