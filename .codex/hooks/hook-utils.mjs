import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HOOK_BLOCKED = 2;

export async function readEvent() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function report(eventName, warnings, denial) {
  const output = { hookSpecificOutput: { hookEventName: eventName } };
  if (warnings.length) {
    output.hookSpecificOutput.additionalContext = warnings.join('\n');
  }
  if (denial) {
    output.hookSpecificOutput.permissionDecision = 'deny';
    output.hookSpecificOutput.permissionDecisionReason = denial;
  }
  process.stdout.write(JSON.stringify(output));
}

export function reportFailure(error) {
  process.stderr.write('OpenStory hook failed: ' + error.message + '\n');
  process.exitCode = HOOK_BLOCKED;
}

const WINDOWS_UNC_PREFIX = '\\\\?\\UNC\\';

function normalizeWindowsPath(file) {
  if (process.platform !== 'win32') return file;
  if (file.toUpperCase().startsWith(WINDOWS_UNC_PREFIX)) {
    return '\\\\' + file.slice(WINDOWS_UNC_PREFIX.length);
  }
  return file.replace(/^\\\\\?\\(?=[a-z]:\\)/i, '');
}

export function projectPath(file, cwd = REPO_ROOT) {
  const absolute = resolve(
    normalizeWindowsPath(cwd),
    normalizeWindowsPath(file)
  );
  const local = relative(normalizeWindowsPath(REPO_ROOT), absolute);
  if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) {
    return null;
  }
  return { absolute, relative: local.replaceAll('\\', '/') };
}

export function patchEdits(command) {
  const edits = [];
  let current;
  for (const line of command.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = { path: header[2], added: [], deleted: header[1] === 'Delete' };
      edits.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('*** Move to: ')) {
      edits.push({ path: current.path, added: [], deleted: true });
      current.path = line.slice('*** Move to: '.length);
      continue;
    }
    if (line.startsWith('+')) current.added.push(line.slice(1));
  }
  return edits;
}

export function eventEdits(event) {
  if (event.tool_name !== 'apply_patch') return [];
  return patchEdits(event.tool_input.command);
}
