import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const usage =
  'Usage: node inspect-range.mjs --base <sha/ref> --target <sha/ref> [--start <local-start>] [--require-complete]';

function git(cwd, ...args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function lines(value) {
  return value ? value.split(/\r?\n/) : [];
}

function commit(cwd, ref) {
  return git(
    cwd,
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`
  );
}

function isAncestor(cwd, ancestor, descendant) {
  try {
    git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function commits(cwd, range, mergesOnly = false) {
  const filter = mergesOnly ? ['--merges'] : [];
  return lines(
    git(
      cwd,
      'log',
      '--first-parent',
      '--reverse',
      ...filter,
      '--format=%H%x09%P%x09%s',
      range
    )
  ).map((line) => {
    const [sha, parents, ...subject] = line.split('\t');
    return { sha, parents: parents.split(' '), subject: subject.join('\t') };
  });
}

function mapping(nodes, merges) {
  const matches = nodes.map((node) => ({
    upstream: node.sha,
    local: merges
      .filter((item) => item.parents[1] === node.sha)
      .map((item) => item.sha),
  }));
  const unique = matches.every((item) => item.local.length === 1);
  const positions = matches.map((item) =>
    merges.findIndex((merge) => merge.sha === item.local[0])
  );
  const ordered =
    unique &&
    positions.every(
      (position, index) => index === 0 || position > positions[index - 1]
    );
  return { matches, unique, ordered };
}

function changes(cwd, base, side) {
  const fields = git(
    cwd,
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    base,
    side
  ).split('\0');
  const result = [];
  let index = 0;
  while (index < fields.length && fields[index]) {
    const status = fields[index++];
    const paths = [fields[index++]];
    if (status.startsWith('R') || status.startsWith('C'))
      paths.push(fields[index++]);
    result.push({ status, paths });
  }
  return result;
}

function compareSides(cwd, head, target) {
  const commonAncestors = lines(git(cwd, 'merge-base', '--all', head, target));
  const comparisonBase =
    commonAncestors.length === 1 ? commonAncestors[0] : null;
  if (!comparisonBase) {
    return {
      commonAncestors,
      comparisonBase,
      localDelta: null,
      pendingUpstreamDelta: null,
      overlappingPaths: null,
    };
  }
  const localDelta = changes(cwd, comparisonBase, head);
  const pendingUpstreamDelta = changes(cwd, comparisonBase, target);
  const localPaths = new Set(localDelta.flatMap((change) => change.paths));
  const upstreamPaths = new Set(
    pendingUpstreamDelta.flatMap((change) => change.paths)
  );
  const overlappingPaths = [...localPaths]
    .filter((path) => upstreamPaths.has(path))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    commonAncestors,
    comparisonBase,
    localDelta,
    pendingUpstreamDelta,
    overlappingPaths,
  };
}

function inspect(values) {
  const cwd = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const base = commit(cwd, values.base);
  const target = commit(cwd, values.target);
  const head = commit(cwd, 'HEAD');
  if (!isAncestor(cwd, base, target) || !isAncestor(cwd, base, head)) {
    throw new Error(
      'The base must be an ancestor of both the target and current HEAD.'
    );
  }
  const start = values.start ? commit(cwd, values.start) : null;
  if (start && !isAncestor(cwd, start, head)) {
    throw new Error('The local start must be an ancestor of current HEAD.');
  }
  const nodes = commits(cwd, `${base}..${target}`);
  const merges = start ? commits(cwd, `${start}..${head}`, true) : null;
  const pending = lines(git(cwd, 'rev-list', target, `^${head}`));
  const operations = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const inProgress = operations.filter((name) =>
    existsSync(resolve(cwd, git(cwd, 'rev-parse', '--git-path', name)))
  );
  return {
    repository: cwd,
    branch: git(cwd, 'branch', '--show-current'),
    head,
    base,
    target,
    start,
    localChanges: lines(git(cwd, 'status', '--porcelain=v1')),
    inProgress,
    mainlineCount: nodes.length,
    historyCount: Number(git(cwd, 'rev-list', '--count', `${base}..${target}`)),
    nodes,
    targetIsAncestor: isAncestor(cwd, target, head),
    missingHistory: pending,
    mergeMapping: merges ? mapping(nodes, merges) : null,
    threeWay: compareSides(cwd, head, target),
  };
}

function isComplete(result) {
  return (
    result.targetIsAncestor &&
    result.missingHistory.length === 0 &&
    result.mergeMapping.ordered &&
    result.inProgress.length === 0
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      target: { type: 'string' },
      start: { type: 'string' },
      'require-complete': { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return process.stdout.write(`${usage}\n`);
  if (
    !values.base ||
    !values.target ||
    (values['require-complete'] && !values.start)
  ) {
    throw new Error(usage);
  }
  const result = inspect(values);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (values['require-complete'] && !isComplete(result)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
