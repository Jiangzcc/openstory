import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, matchesGlob } from 'node:path';
import { eventEdits, projectPath, REPO_ROOT } from './hook-utils.mjs';

const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx)$/;
const TOOL_TIMEOUT_MS = 25000;
const TOOL_OUTPUT_BYTES = 1024 * 1024;
const LOCAL_TOOLS = ['oxfmt', 'oxlint'];

function isIgnored(file, patterns) {
  return patterns.some((pattern) => {
    const candidate = pattern.includes('/') ? file : basename(file);
    return matchesGlob(candidate, pattern);
  });
}

export function formattingTargets(event, ignorePatterns = []) {
  return [
    ...new Set(
      eventEdits(event)
        .filter((edit) => !edit.deleted)
        .map((edit) => projectPath(edit.path, event.cwd))
        .filter((file) => file && SOURCE_EXTENSION.test(file.relative))
        .filter((file) => !isIgnored(file.relative, ignorePatterns))
        .map((file) => file.absolute)
    ),
  ];
}

function runTool(name, targets) {
  const packageDir = join(REPO_ROOT, 'node_modules', name);
  const manifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8')
  );
  const executable = join(packageDir, manifest.bin[name]);
  const args = name === 'oxlint' ? ['--fix', ...targets] : targets;
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: TOOL_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(name + ' failed: ' + (result.stderr || result.stdout));
  }
}

export function formatEditedFiles(event) {
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, '.oxfmtrc.json'), 'utf8')
  );
  const targets = formattingTargets(event, config.ignorePatterns)
    .filter((file) => existsSync(file))
    .filter((file) => projectPath(realpathSync(file)));
  if (!targets.length) return;
  for (const tool of LOCAL_TOOLS) runTool(tool, targets);
}
