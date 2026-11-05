import { spawnSync } from 'node:child_process';
import { join, toNamespacedPath } from 'node:path';
import { expect, it } from 'vitest';
import { formattingTargets } from './format-files.mjs';
import { projectPath, REPO_ROOT } from './hook-utils.mjs';
import { evaluatePreToolUse } from './policies.mjs';

// Events are fixtures; replay only executes the local pre hook.
const HOOK_TIMEOUT_MS = 10000;
const WINDOWS = process.platform === 'win32';
const NAMESPACED_ROOT = toNamespacedPath(REPO_ROOT);
const SOURCE_PATH = 'src/hook-regression.ts';
const SQL_READS = [
  "SELECT REPLACE('abc', 'a', 'z') AS value",
  "select replace(name, 'old', 'new') from sqlite_master",
  "SELECT '; DELETE FROM shots' AS text",
  'SELECT "UPDATE", [DELETE], ' + '\u0060REPLACE\u0060' + ' FROM shots',
  "SELECT REPLACE('a;--/*()', ';', 'x')",
  "SELECT 'it''s; DROP TABLE shots'",
  "-- DELETE FROM shots\nSELECT REPLACE('abc', 'a', 'z')",
  '/* UPDATE shots */ SELECT 1; -- DELETE FROM shots\nSELECT 2',
  "SELECT REPLACE('a', 'a', 'b'); SELECT 2",
  "WITH cte AS (SELECT 1) SELECT REPLACE('abc', 'a', 'z')",
  "WITH cte(value) AS (SELECT 1) SELECT REPLACE('abc', 'a', 'z')",
  'WITH RECURSIVE cte(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM cte WHERE n<3) SELECT n FROM cte',
  'WITH cte AS (SELECT 1), other AS (SELECT 2) SELECT * FROM other',
  'WITH "UPDATE" AS (SELECT 1) SELECT * FROM "UPDATE"',
  'WITH cte AS NOT MATERIALIZED (SELECT 1) SELECT * FROM cte',
  "WITH replace AS (SELECT 1) SELECT REPLACE('abc', 'a', 'z')",
  'EXPLAIN DELETE FROM shots',
];
const SQL_WRITES = [
  'UPDATE shots SET title = 1',
  'INSERT INTO shots (id) VALUES (1)',
  'REPLACE INTO shots (id) VALUES (1)',
  'DELETE FROM shots',
  'DROP TABLE shots',
  'ALTER TABLE shots ADD COLUMN extra TEXT',
  'CREATE TABLE scratch (id TEXT)',
  'VACUUM',
  "ATTACH DATABASE 'extra.db' AS extra",
  "SELECT REPLACE('a', 'a', 'b'); DELETE FROM shots",
  "SELECT '; UPDATE shots' AS text; UPDATE shots SET title = 1",
  'SELECT 1; /* skip */ -- heading\nDELETE FROM shots',
  'SELECT 1; WITH cte AS (SELECT 1) DELETE FROM shots',
  'WITH cte AS (SELECT 1) UPDATE shots SET title = 1',
  'WITH cte(id) AS (SELECT 1) INSERT INTO shots SELECT * FROM cte',
  'WITH cte AS (SELECT 1), other AS (SELECT 2) DELETE FROM shots',
  'WITH cte AS MATERIALIZED (SELECT 1) REPLACE INTO shots SELECT * FROM cte',
  'WITH cte AS (SELECT 1) SELECT * FROM cte; DELETE FROM shots',
  "SELECT '/*'; DELETE FROM shots",
  "SELECT '--'; DELETE FROM shots",
  'SELECT 1; WITH cte AS (SELECT 1), next AS (SELECT 2) UPDATE shots SET title = 2',
];

function sqlEvent(sql, mode = '--remote') {
  const quoted = "'" + sql.replaceAll("'", "''") + "'";
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: REPO_ROOT,
    tool_input: {
      command: 'wrangler d1 execute DB ' + mode + ' --command ' + quoted,
    },
  };
}

function patchEvent(file = SOURCE_PATH, cwd = REPO_ROOT) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd,
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: ' + file,
        '+db.transaction(() => {});',
        '*** End Patch',
      ].join('\n'),
    },
  };
}

function replay(event) {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, '.codex/hooks/pre-tool-use.mjs')],
    {
      cwd: REPO_ROOT,
      input: JSON.stringify(event),
      encoding: 'utf8',
      timeout: HOOK_TIMEOUT_MS,
      windowsHide: true,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  expect(output.hookEventName).toBe('PreToolUse');
  return output;
}

it.each(SQL_READS)('allows a read statement: %s', (sql) => {
  expect(evaluatePreToolUse(sqlEvent(sql)).denial).toBeUndefined();
});

it.each(SQL_WRITES)('blocks a write statement: %s', (sql) => {
  expect(evaluatePreToolUse(sqlEvent(sql)).denial).toBeDefined();
});

it.each(['--local', '--remote=false'])(
  'keeps explicitly local writes allowed: %s',
  (mode) => {
    expect(
      evaluatePreToolUse(sqlEvent(SQL_WRITES[0], mode)).denial
    ).toBeUndefined();
  }
);

it.each([false, true])('replays a SQL decision (write=%s)', (write) => {
  const event = sqlEvent(write ? 'SELECT 1; DELETE FROM shots' : SQL_READS[0]);
  expect(replay(event).permissionDecision).toBe(write ? 'deny' : undefined);
});

it.runIf(WINDOWS).each([
  [SOURCE_PATH, NAMESPACED_ROOT],
  [toNamespacedPath(join(REPO_ROOT, SOURCE_PATH)), REPO_ROOT],
  ['../hook-regression.ts', join(NAMESPACED_ROOT, 'src/nested')],
  [SOURCE_PATH, NAMESPACED_ROOT.toLowerCase()],
])('normalizes an equivalent Windows path: %s', (file, cwd) => {
  const actual = projectPath(file, cwd);
  expect(actual?.relative).toBe(SOURCE_PATH);
  expect(actual?.absolute.toLowerCase()).toBe(
    join(REPO_ROOT, SOURCE_PATH).toLowerCase()
  );
});

it
  .runIf(WINDOWS)
  .each([
    '../outside.ts',
    toNamespacedPath(join(REPO_ROOT, '../outside.ts')),
    toNamespacedPath(join(REPO_ROOT, '../openstory-sibling/file.ts')),
    '\\\\?\\Z:\\outside.ts',
    '\\\\?\\UNC\\server\\share\\outside.ts',
  ])('rejects an outside Windows path: %s', (file) => {
  expect(projectPath(file, NAMESPACED_ROOT)).toBeNull();
  expect(formattingTargets(patchEvent(file, NAMESPACED_ROOT))).toEqual([]);
});

it.runIf(WINDOWS)('keeps formatting targets for a namespaced cwd', () => {
  const event = patchEvent(SOURCE_PATH, NAMESPACED_ROOT);
  expect(formattingTargets(event)).toEqual([join(REPO_ROOT, SOURCE_PATH)]);
});

it.runIf(WINDOWS).each([
  [SOURCE_PATH, NAMESPACED_ROOT],
  [toNamespacedPath(join(REPO_ROOT, SOURCE_PATH)), REPO_ROOT],
])('replays transaction denial for a Windows path: %s', (file, cwd) => {
  expect(replay(patchEvent(file, cwd)).permissionDecision).toBe('deny');
});

it.runIf(WINDOWS)('replays migration denial for a namespaced cwd', () => {
  const event = patchEvent(
    'drizzle/migrations/20260101000000_hook/migration.sql',
    NAMESPACED_ROOT
  );
  event.tool_input.command = event.tool_input.command.replace(
    'db.transaction(() => {});',
    'DROP TABLE shots;'
  );
  expect(replay(event).permissionDecision).toBe('deny');
});

it.runIf(WINDOWS)('replays metadata warnings for a namespaced cwd', () => {
  const event = patchEvent(
    'drizzle/migrations/meta/_journal.json',
    NAMESPACED_ROOT
  );
  expect(replay(event).additionalContext).toContain('journal/snapshot');
});
