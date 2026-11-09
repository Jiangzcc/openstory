import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLocalizationChanges } from './check-localization-changes';

let fixtureRoot: string;
let baseline: string;
let changed: string;
const PAGE = 'src/example/ui/中文 page.tsx';
const REMOVED = 'src/example/ui/removed.tsx';

function git(args: string[]) {
  return execFileSync('git', ['-C', fixtureRoot, ...args], {
    encoding: 'utf8',
  }).trim();
}

function put(file: string, source: string) {
  const target = join(fixtureRoot, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

// A temporary local repository supplies real refs and filenames, without network or providers.
beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'openstory-localization-'));
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Localization Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'core.autocrlf', 'false']);
  put(PAGE, "t('Old copy');");
  put(REMOVED, "t('Removed copy');");
  git(['add', '--', 'src']);
  git(['commit', '--quiet', '-m', 'fixture baseline']);
  baseline = git(['rev-parse', 'HEAD']);
  put(PAGE, "t('Committed copy');");
  git(['add', '--', 'src']);
  git(['commit', '--quiet', '-m', 'fixture change']);
  changed = git(['rev-parse', 'HEAD']);
  put(PAGE, "t('Staged copy');");
  git(['add', '--', PAGE]);
  put(PAGE, "t('Working copy');");
  rmSync(join(fixtureRoot, REMOVED));
  put('src/example/ui/untracked.tsx', "t('Untracked copy');");
  put('.gitignore', 'ignored.tsx\n');
  put('src/example/ui/ignored.tsx', "t('Ignored copy');");
});

afterAll(() => {
  const target = resolve(fixtureRoot);
  const allowedRoot = resolve(tmpdir()) + sep;
  if (
    !target.startsWith(allowedRoot) ||
    !target.split(sep).at(-1)?.startsWith('openstory-localization-')
  ) {
    throw new Error('Refusing cleanup outside the mock repository.');
  }
  rmSync(target, { recursive: true, force: true });
});

describe('committed localization comparisons', () => {
  it('compares immutable refs while ignoring working and untracked changes', () => {
    const { report } = checkLocalizationChanges(fixtureRoot, [
      '--base',
      baseline,
      '--head',
      changed,
    ]);
    expect(report.base).toBe(baseline);
    expect(report.head).toBe(changed);
    expect(report.uiCopy).toHaveLength(1);
    expect(report.uiCopy[0]?.file).toBe(PAGE);
    expect(report.uiCopy[0]?.added[0]?.text).toBe('Committed copy');
    expect(report.uiCopy[0]?.removed[0]?.text).toBe('Old copy');
  });

  it('returns an empty diff for the same revision', () => {
    const { report } = checkLocalizationChanges(fixtureRoot, [
      '--base',
      changed,
      '--head',
      changed,
    ]);
    expect(report.sources).toEqual([]);
    expect(report.uiCopy).toEqual([]);
  });

  it('rejects an unknown revision rather than manufacturing a baseline', () => {
    expect(() =>
      checkLocalizationChanges(fixtureRoot, ['--base', 'missing-fixture-ref'])
    ).toThrow();
  });
});

describe('working tree localization comparisons', () => {
  it('includes combined staged, unstaged, removed and untracked sources', () => {
    const { report } = checkLocalizationChanges(fixtureRoot, []);
    const changes = Object.fromEntries(
      report.uiCopy.map((entry) => [entry.file, entry])
    );
    expect(changes[PAGE]?.added[0]?.text).toBe('Working copy');
    expect(changes[PAGE]?.removed[0]?.text).toBe('Committed copy');
    expect(changes[REMOVED]?.removed[0]?.text).toBe('Removed copy');
    expect(changes['src/example/ui/untracked.tsx']?.added[0]?.text).toBe(
      'Untracked copy'
    );
    expect(changes['src/example/ui/ignored.tsx']).toBeUndefined();
    expect(report.head).toBe('working-tree');
  });

  it('writes only the requested report and leaves source/index data untouched', () => {
    const source = readFileSync(join(fixtureRoot, PAGE), 'utf8');
    const staged = git(['show', ':' + PAGE]);
    const { report } = checkLocalizationChanges(fixtureRoot, [
      '--out',
      '.reports/review.json',
    ]);
    expect(
      JSON.parse(
        readFileSync(join(fixtureRoot, '.reports/review.json'), 'utf8')
      )
    ).toEqual(report);
    expect(readFileSync(join(fixtureRoot, PAGE), 'utf8')).toBe(source);
    expect(git(['show', ':' + PAGE])).toBe(staged);
  });

  it.each([['--unknown', 'x'], ['--base'], ['--head', '--out']])(
    'rejects unsupported or incomplete options: %j',
    (...args) => {
      expect(() => checkLocalizationChanges(fixtureRoot, args)).toThrow(
        'Usage:'
      );
    }
  );
});

describe('report output ownership', () => {
  it('refuses to overwrite inspected source files and preserves their contents', () => {
    const original = readFileSync(join(fixtureRoot, PAGE), 'utf8');
    const output = process.platform === 'win32' ? PAGE.toUpperCase() : PAGE;
    expect(() =>
      checkLocalizationChanges(fixtureRoot, ['--out', output])
    ).toThrow('Report output would overwrite an inspected source file');
    expect(readFileSync(join(fixtureRoot, PAGE), 'utf8')).toBe(original);
  });

  it.each([PAGE, REMOVED])(
    'refuses absolute output over current or deleted sources: %s',
    (file) => {
      const output = join(git(['rev-parse', '--show-toplevel']), file);
      const existed = existsSync(output);
      const staged = git(['show', ':' + file]);
      expect(() =>
        checkLocalizationChanges(fixtureRoot, ['--out', output])
      ).toThrow('Report output would overwrite an inspected source file');
      expect(existsSync(output)).toBe(existed);
      expect(git(['show', ':' + file])).toBe(staged);
    }
  );
});
