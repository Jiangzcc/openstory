import type { i18n as I18n } from 'i18next';

export function localizeSpeakerConflict(
  i18n: I18n,
  message: string,
  characterNames: readonly string[] = []
): string {
  const duplicate =
    /^(\d+) cast characters are named "(.*)"\. Rename one so dialogue knows who speaks\.$/s.exec(
      message
    );
  if (duplicate) {
    return i18n.t(
      '{{value1}} cast characters are named "{{name}}". Rename one so dialogue knows who speaks.',
      {
        ns: 'shots',
        value1: duplicate[1],
        name: duplicate[2],
      }
    );
  }
  const ambiguous =
    /^"(.*)" could be (.*)\. Use the full name so dialogue knows who speaks\.$/s.exec(
      message
    );
  if (ambiguous) {
    const rawCandidates = ambiguous[2] ?? '';
    const names = rawCandidates.split(' or ');
    const canJoin =
      names.every((name) => characterNames.includes(name)) &&
      !characterNames.some(
        (name) => name.includes(' or ') && rawCandidates.includes(name)
      );
    return i18n.t(
      '"{{name}}" could be {{candidates}}. Use the full name so dialogue knows who speaks.',
      {
        ns: 'shots',
        name: ambiguous[1],
        candidates: canJoin
          ? names.join(i18n.t(' or ', { ns: 'shots' }))
          : rawCandidates,
      }
    );
  }
  return message;
}
