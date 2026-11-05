import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath, REPO_ROOT } from './hook-utils.mjs';
import { commandName, shellCommands } from './shell-commands.mjs';

const PACKAGE_SCRIPTS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
).scripts;
const PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);
const RUNNER_OPTIONS = new Set([
  '--package',
  '-p',
  '--cwd',
  '--env-file',
  '--config',
  '--filter',
  '-C',
  '--preload',
  '-r',
]);
const GLOBAL_OPTIONS = new Set(['--env', '-e', '--config', '-c', '--cwd']);
const REMOTE_SCRIPT =
  /^(?:db:(?:migrate|push|studio|seed):(?:d1|prd)|cf:deploy:prd|deploy:production|setup:(?:prd|stg|deploy))$/;
const SQL_WRITE =
  /^(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|VACUUM|ATTACH)$/i;
const SQL_TOKENS =
  /--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*'|"(?:""|[^"])*"|\x60(?:\x60\x60|[^\x60])*\x60|\[[^\]]*\]|[A-Z_]\w*|[();,]/gi;
const METADATA_PATH = /^drizzle\/migrations\/(?:meta\/|.+\/snapshot\.json$)/;
const MIGRATION_PATH = /^drizzle\/migrations\/[0-9]/;
const FILE_WRITERS = new Set([
  'rm',
  'mv',
  'cp',
  'tee',
  'truncate',
  'remove-item',
  'move-item',
  'copy-item',
  'set-content',
  'add-content',
  'out-file',
]);
const FILE_MOVERS = new Set(['rm', 'mv', 'remove-item', 'move-item']);
const PATH_OPTIONS = new Set([
  '-path',
  '-literalpath',
  '-destination',
  '-filepath',
]);
const DATA_OPTIONS = new Set([
  '-value',
  '-encoding',
  '-filter',
  '-include',
  '-exclude',
]);

function trimOptions(args, valueOptions) {
  let index = 0;
  while (args[index]?.startsWith('-')) {
    index += valueOptions.has(args[index]) ? 2 : 1;
  }
  return args.slice(index);
}

function packageCall(name, args) {
  const runnerArgs =
    args[0] === 'run' ? trimOptions(args.slice(1), RUNNER_OPTIONS) : args;
  if (typeof PACKAGE_SCRIPTS[runnerArgs[0]] === 'string') return { name, args };
  return { name: commandName(runnerArgs[0]), args: runnerArgs.slice(1) };
}

function executableWords(words) {
  let index = commandName(words[0]) === 'env' ? 1 : 0;
  while (/^[A-Za-z_]\w*=/.test(words[index] ?? '')) index++;
  return words.slice(index);
}

function toolCall(rawWords) {
  const words = executableWords(rawWords);
  let name = commandName(words[0]);
  let args = words.slice(1);
  if (PACKAGE_MANAGERS.has(name) || ['bunx', 'npx'].includes(name)) {
    args = trimOptions(args, RUNNER_OPTIONS);
  }
  if (name === 'bun' && args[0] === 'x') {
    name = 'bunx';
    args = trimOptions(args.slice(1), RUNNER_OPTIONS);
  }
  if (name === 'bunx' || name === 'npx') {
    return { name: commandName(args[0]), args: args.slice(1) };
  }
  return PACKAGE_MANAGERS.has(name) ? packageCall(name, args) : { name, args };
}

function optionValues(args, option) {
  const values = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === option) values.push(args[index + 1] ?? '');
    if (args[index].startsWith(option + '='))
      values.push(args[index].slice(option.length + 1));
  }
  return values;
}

function* topLevelSqlTokens(sql) {
  let depth = 0;
  for (const [token] of sql.matchAll(SQL_TOKENS)) {
    if (token.startsWith('--') || token.startsWith('/*')) continue;
    if (token === ')') depth--;
    if (depth === 0) yield token.toUpperCase();
    if (token === '(') depth++;
  }
}

function statementWrites(tokens) {
  if (tokens[0] !== 'WITH') return SQL_WRITE.test(tokens[0] ?? '');
  for (let index = 1; index < tokens.length; index++) {
    if (tokens[index] !== ')') continue;
    const verb = tokens[index + 1];
    if (SQL_WRITE.test(verb ?? '')) return true;
    if (['SELECT', 'VALUES'].includes(verb)) return false;
  }
  return false;
}

function sqlWrites(sql) {
  let statement = [];
  for (const token of topLevelSqlTokens(sql)) {
    if (token !== ';') {
      statement.push(token);
      continue;
    }
    if (statementWrites(statement)) return true;
    statement = [];
  }
  return statementWrites(statement);
}

function writesRemoteD1(args) {
  const route = trimOptions(args, GLOBAL_OPTIONS);
  const remote =
    args.includes('--remote') ||
    optionValues(args, '--remote').some((value) => value !== 'false');
  if (route[0] !== 'd1' || !remote) return false;
  if (route[1] === 'migrations' && route[2] === 'apply') return true;
  if (route[1] !== 'execute') return false;
  if (optionValues(args, '--file').length) return true;
  return optionValues(args, '--command').some(sqlWrites);
}

function scriptName(call) {
  if (!PACKAGE_MANAGERS.has(call.name)) return undefined;
  const args =
    call.args[0] === 'run'
      ? trimOptions(call.args.slice(1), RUNNER_OPTIONS)
      : call.args;
  return args[0];
}

export function isRemoteCommand(words, seen = new Set()) {
  const call = toolCall(words);
  const script = scriptName(call);
  if (REMOTE_SCRIPT.test(script ?? '')) return true;
  const nestedScript = PACKAGE_SCRIPTS[script];
  if (typeof nestedScript === 'string' && !seen.has(script)) {
    seen.add(script);
    return shellCommands(nestedScript).some((nested) =>
      isRemoteCommand(nested, seen)
    );
  }
  const route = trimOptions(call.args, GLOBAL_OPTIONS);
  if (call.name === 'wrangler')
    return route[0] === 'deploy' || writesRemoteD1(call.args);
  if (call.name !== 'drizzle-kit') return false;
  const liveConfig = optionValues(call.args, '--config').some((file) =>
    file.endsWith('drizzle.config.d1.ts')
  );
  return liveConfig && ['migrate', 'push'].includes(route[0]);
}

function pathOperands(args) {
  const named = [];
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const option = args[index].toLowerCase();
    if (PATH_OPTIONS.has(option)) {
      named.push(args[++index]);
      continue;
    }
    if (DATA_OPTIONS.has(option)) {
      index++;
      continue;
    }
    if (!option.startsWith('-')) positional.push(args[index]);
  }
  return { named, positional };
}

function metadataWarning(words, cwd) {
  const name = commandName(words[0]);
  const args = words.slice(1);
  const isWriter =
    FILE_WRITERS.has(name) ||
    (name === 'sed' && args.some((arg) => arg.startsWith('-i')));
  const { named, positional } = pathOperands(args);
  const operands = name.includes('-')
    ? named.concat(positional.slice(0, 1))
    : positional;
  const files = operands
    .filter(Boolean)
    .map((file) => projectPath(file, cwd))
    .filter(Boolean);
  if (isWriter && files.some((file) => METADATA_PATH.test(file.relative)))
    return true;
  if (
    FILE_MOVERS.has(name) &&
    files.some((file) => MIGRATION_PATH.test(file.relative))
  )
    return true;
  const targets = args.filter((_, index) =>
    ['>', '>>'].includes(args[index - 1])
  );
  return targets
    .map((file) => projectPath(file, cwd))
    .some((file) => file && METADATA_PATH.test(file.relative));
}

export function commandWarnings(words, cwd) {
  const warnings = [];
  if (metadataWarning(words, cwd)) {
    warnings.push(
      '迁移 journal/snapshot 由 drizzle-kit 生成；不要手工改写或删除迁移目录。已授权的恢复流程见 AGENTS.md。'
    );
  }
  if (['find', 'grep'].includes(commandName(words[0]))) {
    warnings.push('搜索优先使用 rg；只有 rg 不可用时才采用其他工具。');
  }
  return warnings;
}

export function isGenerateCommand(words) {
  const call = toolCall(words);
  const script = scriptName(call);
  if (/^db:generate(?::|$)/.test(script ?? '')) return true;
  return (
    call.name === 'drizzle-kit' &&
    trimOptions(call.args, GLOBAL_OPTIONS)[0] === 'generate'
  );
}
