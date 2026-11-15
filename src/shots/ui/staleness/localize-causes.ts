import type { TFunction } from 'i18next';

const FIELDS = [
  'name',
  'age',
  'gender',
  'ethnicity',
  'description',
  'rendering',
  'personality',
  'movement',
  'voice only',
  'person',
  'tag',
  'clothing',
  'styling',
  'features',
  'interior/exterior',
  'architecture',
  'ambiance',
  'mood',
  'art style',
  'lighting',
  'palette',
  'camera',
  'references',
  'grading',
  'medium',
  'shots',
  'pace',
  'energy',
  'heading',
  'time of day',
  'story beat',
  'cast and tags',
  'duration',
  'cast',
  'tags',
  'location tag',
  'look',
  'sheet',
  'default look sheet',
  'reference photo',
  'reference photos',
] as const;

const FLAT_CAUSES = [
  ...FIELDS,
  'Aspect ratio',
  'Script model',
  'Image model',
  'Music model',
  'Start frame mode',
  'Image re-rendered',
  'Visual prompt',
  'Seed',
  'Size',
  'Character sheet',
  'Location sheet',
  'Element reference',
  'Shot spec',
  'Script',
  'Dialogue',
  'Music prompt',
  'Tags',
  'Duration',
  'Style',
  'Scene details',
] as const;

type Field = (typeof FIELDS)[number];
type FlatCause = (typeof FLAT_CAUSES)[number];
const fields = new Set<string>(FIELDS);
const flatCauses = new Set<string>(FLAT_CAUSES);
const isField = (value: string): value is Field => fields.has(value);
const isFlatCause = (value: string): value is FlatCause =>
  flatCauses.has(value);

function localizeFields(value: string, translate: TFunction<'shots'>) {
  const items = value.split(', ');
  if (!items.every(isField)) return null;
  return items.map((field) => translate(field)).join(', ');
}

function localizeNamedCause(cause: string, translate: TFunction<'shots'>) {
  const detailed = /^(Character|Location) (".*"(?: \(.*\))?): (.*)$/s.exec(
    cause
  );
  if (detailed) {
    const [, kind, identity = '', value = ''] = detailed;
    const translated = localizeFields(value, translate);
    if (translated === null) return cause;
    return kind === 'Character'
      ? translate('Character {{value1}}: {{value2}}', {
          value1: identity,
          value2: translated,
        })
      : translate('Location {{value1}}: {{value2}}', {
          value1: identity,
          value2: translated,
        });
  }
  const bare = /^(Character|Location) (".*"(?: \(.*\))?)$/s.exec(cause);
  if (!bare) return null;
  return bare[1] === 'Character'
    ? translate('Character {{value1}}', { value1: bare[2] })
    : translate('Location {{value1}}', { value1: bare[2] });
}

function localizeGroupCause(cause: string, translate: TFunction<'shots'>) {
  const scene = /^Scene ([1-9]\d*): (.*)$/s.exec(cause);
  if (scene) {
    const translated = localizeFields(scene[2] ?? '', translate);
    return translated === null
      ? cause
      : translate('Scene {{value1}}: {{value2}}', {
          value1: scene[1],
          value2: translated,
        });
  }
  const group = /^(Scene|Style): (.*)$/s.exec(cause);
  if (!group) return null;
  const translated = localizeFields(group[2] ?? '', translate);
  if (translated === null) return cause;
  return group[1] === 'Scene'
    ? translate('Scene: {{value1}}', { value1: translated })
    : translate('Style: {{value1}}', { value1: translated });
}

function localizeCause(cause: string, translate: TFunction<'shots'>): string {
  if (isFlatCause(cause)) return translate(cause);
  const structured =
    localizeNamedCause(cause, translate) ??
    localizeGroupCause(cause, translate);
  if (structured !== null) return structured;
  const element = /^Element (.+)$/s.exec(cause);
  if (element) return translate('Element {{value1}}', { value1: element[1] });
  const scene = /^Scene ([1-9]\d*)$/.exec(cause);
  return scene ? translate('Scene {{value1}}', { value1: scene[1] }) : cause;
}

/** Only for causes emitted by the manifest and legacy staleness producers. */
export function localizeCauses(
  causes: readonly string[],
  translate: TFunction<'shots'>
): string[] {
  return causes.map((cause) => localizeCause(cause, translate));
}
