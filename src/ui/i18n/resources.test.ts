import { describe, expect, it } from 'vitest';
import { FAQ_ITEMS } from '@/ui/marketing/constants';
import { applicationResources } from './resources';
import { createApplicationI18n } from './runtime';

const GRAMMAR_SUFFIXES = new Map<string, string[]>([
  ['models:Set {{value1}} on {{value2}} scene{{value3}}', ['value3']],
  ['models:{{value1}} scene{{value2}}', ['value2']],
  ['studio:Imported the prompt and {{value1}} reference{{value2}}', ['value2']],
  ['cast:{{value1}} shot{{value2}}', ['value2']],
  ['cast:{{value1}} shot{{value2}}{{value3}}', ['value2']],
  [
    'cast: {{value1}} shot{{value2}} still mention it — those prompts will keep the token until you edit them.',
    ['value2'],
  ],
  [
    'cast:{{value1}} shot{{value2}} that use it will show as out of date.',
    ['value2'],
  ],
  ['cast:{{value1}} shot{{value2}} will show as out of date', ['value2']],
  [
    'cast:This replaces the reference. {{value1}} shot{{value2}}{{value3}} that use it will show as out of date until you update them.',
    ['value2'],
  ],
  [
    'shots:Updated {{value1}} item{{value2}} — the rest are already being updated',
    ['value2'],
  ],
  [
    'shots:Updated {{value1}} item{{value2}}, {{value3}} could not be updated',
    ['value2'],
  ],
  ['shots:Could not update {{value1}} item{{value2}}', ['value2']],
  [
    'shots:Updated {{value1}} item{{value2}} across {{value3}} shot{{value4}}{{value5}}',
    ['value2', 'value4'],
  ],
  ['history:Split the script into {{value1}} {{value2}}', ['value2']],
]);

const ALLOWED_CONTROL_CHARACTERS = new Set([9, 10, 13]);
const ASCII_CONTROL_LIMIT = 0x20;

function tokens(value: string) {
  return [...value.matchAll(/<\/?\d+\s*\/?>|{{\s*([^}]+?)\s*}}/g)]
    .map((match) => match[0])
    .sort();
}

describe('application language resources', () => {
  it('keeps source keys, rich text, and business interpolation aligned', () => {
    const failures: string[] = [];
    for (const [namespace, english] of Object.entries(
      applicationResources.en
    )) {
      const namespaces: Record<
        string,
        Record<string, string>
      > = applicationResources['zh-CN'];
      const chinese = namespaces[namespace] ?? {};
      expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
      for (const [key, source] of Object.entries(english)) {
        const target = chinese[key] ?? '';
        if (
          !target.trim() ||
          Array.from(target).some(
            (character) =>
              character.charCodeAt(0) < ASCII_CONTROL_LIMIT &&
              !ALLOWED_CONTROL_CHARACTERS.has(character.charCodeAt(0))
          )
        )
          failures.push(`${namespace}: empty/control character: ${key}`);
        const ignored = GRAMMAR_SUFFIXES.get(`${namespace}:${key}`) ?? [];
        const expected = tokens(source).filter(
          (token) => !ignored.some((name) => token === `{{${name}}}`)
        );
        if (JSON.stringify(tokens(target)) !== JSON.stringify(expected))
          failures.push(`${namespace}: ${key}`);
      }
    }
    expect(failures).toEqual([]);
  });
  it('covers FAQ text from the shared upstream source', () => {
    const i18n = createApplicationI18n();
    for (const item of FAQ_ITEMS) {
      for (const source of [item.question, item.answer]) {
        expect(i18n.getResource('en', 'labels', source)).toBe(source);
        const chinese = i18n.getResource('zh-CN', 'labels', source);
        expect(chinese).toEqual(expect.any(String));
        expect(chinese).not.toBe(source);
      }
    }
  });

  it('defaults to Chinese and isolates independent requests', async () => {
    const zh = createApplicationI18n();
    const en = createApplicationI18n('en');
    expect(zh.t('Tell your whole story', { ns: 'labels' })).toBe(
      '完整讲好你的故事'
    );
    expect(en.t('Tell your whole story', { ns: 'labels' })).toBe(
      'Tell your whole story'
    );
    await en.changeLanguage('zh-CN');
    expect(zh.language).toBe('zh-CN');
  });
});
