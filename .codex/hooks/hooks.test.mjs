import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { formattingTargets } from './format-files.mjs';
import { patchEdits, REPO_ROOT } from './hook-utils.mjs';

const SUCCESS = 0;
const BLOCKED = 'deny';
const HOOK_TIMEOUT_MS = 60000;

function patchEvent(file, content, cwd = REPO_ROOT) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd,
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: ' + file,
        ...content.split('\n').map((line) => '+' + line),
        '*** End Patch',
      ].join('\n'),
    },
  };
}

function bashEvent(command) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: REPO_ROOT,
    tool_input: { command },
  };
}

function runHook(name, event, cwd = REPO_ROOT) {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, '.codex/hooks/' + name + '.mjs')],
    {
      cwd,
      encoding: 'utf8',
      input: JSON.stringify(event),
      timeout: HOOK_TIMEOUT_MS,
      windowsHide: true,
    }
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(SUCCESS);
  return JSON.parse(result.stdout).hookSpecificOutput;
}

const deniedCommands = [
  'bun db:migrate:prd',
  'bun run deploy:production',
  'bun cf:deploy:prd',
  'bunx wrangler d1 migrations apply DB --remote',
  'wrangler d1 execute DB --remote --file=repair.sql',
  'wrangler d1 execute DB --remote --command "UPDATE shots SET title = 1"',
  'wrangler d1 execute DB --command "DELETE FROM shots" --remote',
  'bun drizzle-kit push --config=drizzle.config.d1.ts',
];

it.each(deniedCommands)('blocks remote writes: %s', (command) => {
  expect(runHook('pre-tool-use', bashEvent(command)).permissionDecision).toBe(
    BLOCKED
  );
});

const allowedCommands = [
  'bun db:migrate:local',
  'bun db:generate',
  'bun drizzle-kit generate --config=drizzle.config.d1.ts',
  'Get-Content drizzle.config.d1.ts',
  'wrangler d1 execute DB --local --command "DROP TABLE scratch"',
  'wrangler d1 execute DB --remote --command "SELECT count(*) FROM shots"',
  'wrangler d1 execute DB --remote --command "SELECT \'UPDATE\' AS label"',
];

it.each(allowedCommands)(
  'allows local commands and remote reads: %s',
  (command) => {
    expect(
      runHook('pre-tool-use', bashEvent(command)).permissionDecision
    ).toBeUndefined();
  }
);

const blockedEdits = [
  ['src/example.ts', 'db.transaction(async () => {});'],
  ['drizzle/migrations/example/migration.sql', 'DROP TABLE shots;'],
  [
    'drizzle/migrations/example/migration.sql',
    'UPDATE shots SET title = (SELECT name FROM scenes);',
  ],
  [
    'drizzle/migrations/example/migration.sql',
    'UPDATE shots SET title = 1 WHERE EXISTS (SELECT id FROM scenes);',
  ],
  [
    'drizzle/migrations/example/migration.sql',
    'CREATE TABLE __new_shots (id text);',
  ],
];

it.each(blockedEdits)('blocks unsafe edits in %s: %s', (file, content) => {
  expect(
    runHook('pre-tool-use', patchEvent(file, content)).permissionDecision
  ).toBe(BLOCKED);
});

it('permits a set-based migration backfill', () => {
  const event = patchEvent(
    'drizzle/migrations/example/migration.sql',
    'UPDATE shots SET title = src.name FROM scenes AS src WHERE shots.id = src.id;'
  );
  expect(runHook('pre-tool-use', event).permissionDecision).toBeUndefined();
});

it('allows removing an old transaction without matching removed lines', () => {
  const event = patchEvent('src/example.ts', 'db.batch(statements);');
  event.tool_input.command = event.tool_input.command.replace(
    '+db.batch',
    '-db.transaction(old);\n+db.batch'
  );
  expect(runHook('pre-tool-use', event).permissionDecision).toBeUndefined();
});

it('does not block documentation mentioning db.transaction()', () => {
  const event = patchEvent('docs/example.md', 'Do not call db.transaction().');
  expect(runHook('pre-tool-use', event).permissionDecision).toBeUndefined();
});

it('warns when editing generated migration metadata', () => {
  const result = runHook(
    'pre-tool-use',
    patchEvent('drizzle/migrations/meta/_journal.json', '{}')
  );
  expect(result.permissionDecision).toBeUndefined();
  expect(result.additionalContext).toContain('journal/snapshot');
});

it.each([
  'Remove-Item drizzle\\migrations\\20260101000000_example -Recurse',
  'Set-Content drizzle/migrations/meta/_journal.json -Value "{}"',
  'rm drizzle/migrations/example/snapshot.json',
])('warns about shell metadata writes: %s', (command) => {
  expect(
    runHook('pre-tool-use', bashEvent(command)).additionalContext
  ).toContain('journal/snapshot');
});

it('does not warn about reading migration metadata', () => {
  const event = bashEvent('Get-Content drizzle/migrations/meta/_journal.json');
  expect(runHook('pre-tool-use', event).additionalContext).toBeUndefined();
});

it('reports a type assertion as a warning', () => {
  const result = runHook(
    'pre-tool-use',
    patchEvent('src/example.ts', 'const value = input as string;')
  );
  expect(result.permissionDecision).toBeUndefined();
  expect(result.additionalContext).toContain('as');
});

it('reminds the agent to check generated migrations', () => {
  const result = runHook('post-tool-use', bashEvent('bun db:generate'));
  expect(result.hookEventName).toBe('PostToolUse');
  expect(result.additionalContext).toContain('bun scripts/check-migrations.ts');
});

it('prefers rg without blocking a fallback command', () => {
  const result = runHook('pre-tool-use', bashEvent('grep pattern source.ts'));
  expect(result.permissionDecision).toBeUndefined();
  expect(result.additionalContext).toContain('rg');
});

it('extracts the moved destination and removes the source from formatting', () => {
  const command =
    '*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n+export const value = 1;\n*** End Patch';
  const event = { ...patchEvent('', ''), tool_input: { command } };
  expect(patchEdits(command).map((edit) => [edit.path, edit.deleted])).toEqual([
    ['src/new.ts', false],
    ['src/old.ts', true],
  ]);
  expect(formattingTargets(event)).toEqual([join(REPO_ROOT, 'src/new.ts')]);
});

it.each([
  'src/routeTree.gen.ts',
  'public/mockServiceWorker.js',
  '.vscode/settings.json',
])('skips ignored or non-source files: %s', (file) => {
  const ignores = JSON.parse(
    readFileSync(join(REPO_ROOT, '.oxfmtrc.json'), 'utf8')
  ).ignorePatterns;
  expect(formattingTargets(patchEvent(file, ''), ignores)).toEqual([]);
});

it('keeps formatter targets inside the repository', () => {
  expect(formattingTargets(patchEvent('../outside.ts', ''))).toEqual([]);
});

it('resolves edits relative to a nested session directory', () => {
  const event = patchEvent('example.ts', '', join(REPO_ROOT, 'src'));
  expect(formattingTargets(event)).toEqual([join(REPO_ROOT, 'src/example.ts')]);
});

function removeFixture(directory) {
  const local = relative(REPO_ROOT, directory).replaceAll('\\', '/');
  if (!local.startsWith('.codex/hooks/.verify-'))
    throw new Error('Unexpected fixture path');
  rmSync(directory, { recursive: true, force: true });
}

it(
  'runs installed oxfmt and oxlint on only the edited file',
  () => {
    const directory = mkdtempSync(join(REPO_ROOT, '.codex/hooks/.verify-'));
    const file = join(directory, 'example.ts');
    try {
      writeFileSync(file, 'export const value=1');
      const event = patchEvent(file, 'export const value=1');
      expect(runHook('post-tool-use', event).hookEventName).toBe('PostToolUse');
      expect(readFileSync(file, 'utf8')).toBe('export const value = 1;\n');
    } finally {
      removeFixture(directory);
    }
  },
  HOOK_TIMEOUT_MS
);

it(
  'launches the configured hook from a nested session directory',
  () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, '.codex/hooks.json'), 'utf8')
    );
    const command = config.hooks.PreToolUse[0].hooks[0].command;
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : 'sh';
    const args = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command];
    const result = spawnSync(shell, args, {
      cwd: join(REPO_ROOT, 'src'),
      encoding: 'utf8',
      input: JSON.stringify(bashEvent('bun db:migrate:prd')),
      timeout: HOOK_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(SUCCESS);
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe(BLOCKED);
  },
  HOOK_TIMEOUT_MS
);

const additionalDeniedCommands = [
  'bun run deploy',
  'bun deploy',
  'bun run --silent deploy',
  'bunx wrangler deploy',
  'bun x --no-install wrangler deploy',
  'npx --yes wrangler deploy',
  'wrangler --env production deploy',
  '.\\node_modules\\.bin\\wrangler.exe d1 execute DB --remote --command "DELETE FROM shots"',
  'wrangler d1 execute DB --remote --command "SELECT 1"; wrangler d1 execute DB --remote --command "DELETE FROM shots"',
  'wrangler d1 execute DB --remote --command "SELECT 1" && wrangler d1 execute DB --remote --command "UPDATE shots SET title = 1"',
  'wrangler --env production d1 execute DB --remote --command "DELETE FROM shots"',
];

it.each(additionalDeniedCommands)(
  'keeps deployment and each remote command guarded: %s',
  (command) => {
    expect(runHook('pre-tool-use', bashEvent(command)).permissionDecision).toBe(
      BLOCKED
    );
  }
);

const additionalAllowedCommands = [
  'rg -n "db:migrate:prd" package.json',
  'Write-Output "bun cf:deploy:prd"',
  'rg -n "wrangler d1 execute DB --remote --command DELETE" scripts',
  'wrangler d1 execute DB --local --command "UPDATE shots SET title = 1"; wrangler d1 execute DB --remote --command "SELECT 1"',
  'wrangler d1 execute DB --remote --command "SELECT 1; SELECT 2"',
  '# a comment; bun run deploy\nWrite-Output done',
];

it.each(additionalAllowedCommands)(
  'preserves command context for read-only or local work: %s',
  (command) => {
    expect(
      runHook('pre-tool-use', bashEvent(command)).permissionDecision
    ).toBeUndefined();
  }
);

it.each([
  'Set-Content snapshot.json -Value "{}"',
  'Set-Content -LiteralPath snapshot.json -Value "{}"',
  'Write-Output "{}" > snapshot.json',
])('resolves migration metadata from the event cwd: %s', (command) => {
  const event = {
    ...bashEvent(command),
    cwd: join(REPO_ROOT, 'drizzle/migrations/example'),
  };
  expect(runHook('pre-tool-use', event).additionalContext).toContain(
    'journal/snapshot'
  );
});

it('does not mistake setter data for a destination path', () => {
  const event = bashEvent(
    'Set-Content output.log -Value "drizzle/migrations/meta/_journal.json"'
  );
  expect(runHook('pre-tool-use', event).additionalContext).toBeUndefined();
});

it('does not issue a generation reminder for a read-only search', () => {
  const result = runHook(
    'post-tool-use',
    bashEvent('rg "db:generate" package.json')
  );
  expect(result.additionalContext).toBeUndefined();
});

it('checks a direct drizzle generation command', () => {
  const result = runHook(
    'post-tool-use',
    bashEvent('bun drizzle-kit generate --config=drizzle.config.d1.ts')
  );
  expect(result.additionalContext).toContain('check-migrations.ts');
});

it.each([
  'wrangler d1 execute DB --remote=true --command "DELETE FROM shots"',
  'CLOUDFLARE_ENV=production bun run deploy:production',
  'env CLOUDFLARE_ENV=production wrangler deploy',
])('guards ordinary option and environment forms: %s', (command) => {
  expect(runHook('pre-tool-use', bashEvent(command)).permissionDecision).toBe(
    BLOCKED
  );
});

it('allows an explicitly local remote=false invocation', () => {
  const event = bashEvent(
    'wrangler d1 execute DB --remote=false --command "DELETE FROM scratch"'
  );
  expect(runHook('pre-tool-use', event).permissionDecision).toBeUndefined();
});
