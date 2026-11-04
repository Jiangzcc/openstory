import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { ShotMissingVoices } from './motion-dialogue-panel';

describe('voice design cost display', () => {
  it.each(['zh-CN', 'en'] as const)(
    'keeps the cost as React content in %s',
    (locale) => {
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={createApplicationI18n(locale)}>
          <ShotMissingVoices
            speakers={[
              {
                characterId: 'fixture-character',
                name: 'Your character',
                generating: false,
              },
            ]}
            onGenerate={() => {}}
            cost={<span data-testid="voice-cost">$0.25</span>}
          />
        </I18nextProvider>
      );
      expect(html).toContain('<span data-testid="voice-cost">$0.25</span>');
      expect(html).toContain(locale === 'en' ? 'Generate voice' : '生成音色');
      expect(html).toContain('Your character');
      expect(html).not.toContain('[object Object]');
    }
  );
});
