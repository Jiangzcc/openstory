export type ResourceCopyChange = {
  kind: 'added' | 'removed' | 'changed';
  key: string;
  before?: string;
  after?: string;
};
const RESOURCE_PATH =
  /^src\/(?:ui|platform)\/i18n\/locales\/(en|zh-CN)\/([^/]+)\.json$/;

function resourceEntries(source: string | undefined, file: string) {
  if (source === undefined) return new Map<string, string>();
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a flat language resource object: ' + file);
  }
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error('Expected a string translation: ' + file + ':' + key);
    }
    entries.set(key, value);
  }
  return entries;
}

export function compareResourceCopy(
  file: string,
  before: string | undefined,
  after: string | undefined
) {
  const match = RESOURCE_PATH.exec(file);
  if (!match) return undefined;
  const oldEntries = resourceEntries(before, file);
  const newEntries = resourceEntries(after, file);
  const keys = [
    ...new Set([...oldEntries.keys(), ...newEntries.keys()]),
  ].sort();
  const changes: ResourceCopyChange[] = [];
  for (const key of keys) {
    const oldText = oldEntries.get(key);
    const newText = newEntries.get(key);
    if (oldText === newText) continue;
    const kind =
      oldText === undefined
        ? 'added'
        : newText === undefined
          ? 'removed'
          : 'changed';
    changes.push({ kind, key, before: oldText, after: newText });
  }
  return changes.length
    ? {
        file,
        locale: match[1],
        namespaceFile: match[2],
        changes,
        semanticReview: 'required',
      }
    : undefined;
}
