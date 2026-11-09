import { createHash } from 'node:crypto';
import { sourceFingerprint } from './ast';
import { compareResourceCopy } from './resource-copy';
import { comparePromptSource } from './system-prompts';
import { extractUiCopy } from './ui-copy';
import type { UiCopyEntry } from './ui-copy';
import type { SourceSnapshot } from './git-snapshot';

const EXCLUDED_SOURCE =
  /(?:^src\/test\/|\/(?:__tests__|__fixtures__)\/|\.(?:test|spec|stories|gen|generated)\.[cm]?[jt]sx?$)/;
const REPORT_SCHEMA_VERSION = 1;
const REVIEWABLE_SOURCE = /^(?:src\/.*\.(?:ts|tsx|json)|docs\/.*\.md)$/;
const UI_SOURCE = /^src\/(?:.*\.tsx|(?:.*\/)?ui\/.*\.ts)$/;
const HELP_SOURCE =
  /^docs\/(?:getting-started\.md|(?:user-guide|developer-guide|deployment|support)\/.*\.md)$/;

function copyIdentity(entry: UiCopyEntry) {
  const { line: _line, ...copy } = entry;
  return JSON.stringify(copy);
}

function unmatchedEntries(entries: UiCopyEntry[], against: UiCopyEntry[]) {
  const remaining = against.map(copyIdentity);
  return entries.filter((entry) => {
    const index = remaining.indexOf(copyIdentity(entry));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function uiCopyChange(file: string, before: string, after: string) {
  const oldScan = extractUiCopy(before, file);
  const newScan = extractUiCopy(after, file);
  const added = unmatchedEntries(newScan.entries, oldScan.entries);
  const removed = unmatchedEntries(oldScan.entries, newScan.entries);
  const namespaceChanged =
    JSON.stringify([...oldScan.namespaceHints].sort()) !==
    JSON.stringify([...newScan.namespaceHints].sort());
  if (
    !added.length &&
    !removed.length &&
    !newScan.dynamicKeys.length &&
    !namespaceChanged
  )
    return undefined;
  return {
    file,
    added,
    removed,
    dynamicKeys: newScan.dynamicKeys,
    namespaceHints: {
      before: oldScan.namespaceHints,
      after: newScan.namespaceHints,
    },
    review: 'candidate-only',
  };
}

function fileHash(source: string | undefined) {
  return source === undefined
    ? null
    : createHash('sha256').update(source).digest('hex');
}

function changedSource(
  file: string,
  before: SourceSnapshot,
  after: SourceSnapshot
) {
  const oldSource = before.files.has(file) ? before.read(file) : undefined;
  const newSource = after.files.has(file) ? after.read(file) : undefined;
  return {
    oldSource,
    newSource,
    fingerprints: {
      before: fileHash(oldSource),
      after: fileHash(newSource),
    },
  };
}

function compareSourceFile(
  file: string,
  before: SourceSnapshot,
  after: SourceSnapshot
) {
  const { oldSource, newSource, fingerprints } = changedSource(
    file,
    before,
    after
  );
  const resource = compareResourceCopy(file, oldSource, newSource);
  const prompt = comparePromptSource(file, oldSource, newSource, before, after);
  const isUi = UI_SOURCE.test(file) && !EXCLUDED_SOURCE.test(file);
  const sourceChanged =
    isUi &&
    sourceFingerprint(oldSource ?? '', file) !==
      sourceFingerprint(newSource ?? '', file);
  const ui = sourceChanged
    ? uiCopyChange(file, oldSource ?? '', newSource ?? '')
    : undefined;
  return {
    file,
    fingerprints,
    resource,
    prompt,
    ui,
    help: HELP_SOURCE.test(file) && oldSource !== newSource,
    unclassifiedUi: sourceChanged && ui === undefined,
  };
}

export function localizationReport(
  before: SourceSnapshot,
  after: SourceSnapshot,
  files: string[]
) {
  const changes = [...new Set(files)]
    .sort()
    .filter(
      (file) => REVIEWABLE_SOURCE.test(file) && !EXCLUDED_SOURCE.test(file)
    )
    .map((file) => compareSourceFile(file, before, after));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    base: before.revision,
    head: after.revision,
    status: 'report-only',
    uiCopy: changes.flatMap(({ ui }) => (ui ? [ui] : [])),
    resources: changes.flatMap(({ resource }) => (resource ? [resource] : [])),
    systemPrompts: changes.flatMap(({ prompt }) => (prompt ? [prompt] : [])),
    helpMarkdown: changes.filter(({ help }) => help).map(({ file }) => file),
    unclassifiedUiFiles: changes
      .filter(({ unclassifiedUi }) => unclassifiedUi)
      .map(({ file }) => file),
    sources: changes.map(({ file, fingerprints }) => ({
      file,
      ...fingerprints,
    })),
    existingChecks: {
      executedByReport: false,
      command:
        'bun run test src/ui/i18n/resources.test.ts src/ui/i18n/markdown.test.ts src/platform/server/ai/prompts/catalog.test.ts',
    },
    limitations: [
      'Candidates and fingerprints request human review; they never certify translation meaning.',
      'Plain JS lookup tables, aliased translation helpers, dynamic content and external packages need manual review.',
      'Namespace hints are file-level context; only explicit call or Trans namespaces are assigned to keys.',
      'Prompt coverage follows listed owners and prompt-named source candidates; new owners and transitive imports need classification.',
      'No modules, user content or provider requests are executed, and no translations are rewritten.',
    ],
  };
}
