import { describe, expect, it } from 'vitest';
import { createI18n } from './runtime';
import { resolveLocale } from './locale';
import { resources } from './resources';

function resourceTokens(value: string) {
  return [...value.matchAll(/<\/?([A-Za-z]+)>|{{\s*([^}]+?)\s*}}/g)]
    .map((match) => match[0])
    .sort();
}

function resourceTokensByKey(messages: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [key, resourceTokens(value)])
  );
}

describe('locale preference', () => {
  it.each([undefined, null, '', 'en-US', 'fr', '%ZZ', {}, 'zh-CN'])(
    'defaults unsupported preferences to Chinese: %s',
    (value) => expect(resolveLocale(value)).toBe('zh-CN')
  );

  it('keeps an explicit English preference', () => {
    expect(resolveLocale('en')).toBe('en');
  });
});

describe('i18n runtime', () => {
  it('uses the English source text as each translation key', () => {
    for (const messages of Object.values(resources.en)) {
      for (const [source, translated] of Object.entries(messages)) {
        expect(source).toBe(translated);
      }
    }
  });

  it('treats punctuation in source text as part of the key', () => {
    const i18n = createI18n();
    expect(i18n.t('you@example.com', { ns: 'auth' })).toBe('请输入邮箱地址');
    expect(
      i18n.t('AI video production, from script to screen.', { ns: 'auth' })
    ).toBe('AI 视频创作，从剧本到成片。');
  });

  it('has Chinese resources ready before the first render', () => {
    const i18n = createI18n();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.resolvedLanguage).toBe('zh-CN');
    expect(i18n.t('Welcome', { ns: 'auth' })).toBe('欢迎使用 OpenStory');
  });

  it('keeps concurrent request instances isolated', async () => {
    const chinese = createI18n('zh-CN');
    const english = createI18n('en');
    const notices: string[] = [];
    chinese.on('languageChanged', (locale) => notices.push(locale));

    await Promise.all([
      chinese.changeLanguage('en'),
      english.changeLanguage('zh-CN'),
    ]);

    expect(chinese.t('Welcome', { ns: 'auth' })).toBe('Welcome');
    expect(english.t('Welcome', { ns: 'auth' })).toBe('欢迎使用 OpenStory');
    expect(notices).toEqual(['en']);
  });
});

describe('translation resources', () => {
  it('keeps Chinese and English resource keys and rich-text tokens aligned', () => {
    for (const namespace of ['auth', 'common'] as const) {
      const en = resources.en[namespace];
      const zh = resources['zh-CN'][namespace];
      expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    }
    expect(resourceTokensByKey(resources['zh-CN'].auth)).toEqual(
      resourceTokensByKey(resources.en.auth)
    );
    for (const value of Object.values(resources['zh-CN'].auth)) {
      expect(value.trim()).not.toBe('');
    }
    expect(resourceTokensByKey(resources['zh-CN'].common)).toEqual(
      resourceTokensByKey(resources.en.common)
    );
  });
});
