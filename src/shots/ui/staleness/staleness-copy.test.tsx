import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/platform/i18n/locale';
import { SheetStalenessBanners } from '@/cast/ui/sheets/sheet-staleness-banners';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { DivergentAlternateBanner } from './divergent-alternate-banner';
import { StalenessIndicator } from './staleness-indicator';
import type { StalenessArtifact } from './staleness-indicator';

const ARTIFACTS = [
  ['thumbnail', '图像'],
  ['video', '视频'],
  ['audio', '音频'],
  ['sheet', '设定图'],
  ['visual-prompt', '画面提示词'],
  ['motion-prompt', '动态提示词'],
  ['music-prompt', '配乐提示词'],
  ['music', '配乐'],
] as const satisfies readonly (readonly [StalenessArtifact, string])[];

function renderBanner(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      {children}
    </I18nextProvider>
  );
}

describe('staleness copy in the rendered UI', () => {
  it.each(ARTIFACTS)('translates the inline %s name', (artifact, label) => {
    const html = renderBanner(
      'zh-CN',
      <StalenessIndicator
        artifact={artifact}
        entityType="shot"
        onRegenerate={() => undefined}
      />
    );
    expect(html).toContain(`当前${label}是根据修改前的内容和设置生成的。`);
    expect(html).toContain('相关内容或设置已修改');
    expect(html).not.toContain('This ');
  });

  it('translates the character sheet banner through its real wrapper', () => {
    const html = renderBanner(
      'zh-CN',
      <SheetStalenessBanners
        entityType="character"
        isStale
        onRegenerate={() => undefined}
      />
    );
    expect(html).toContain('当前设定图是根据修改前的内容和设置生成的。');
    expect(html).toContain('重新生成');
    expect(html).not.toContain('此sheet');
  });

  it('preserves the English sheet explanation', () => {
    const html = renderBanner(
      'en',
      <SheetStalenessBanners
        entityType="character"
        isStale
        onRegenerate={() => undefined}
      />
    );
    expect(html).toContain('This sheet was generated from earlier inputs.');
  });

  it('translates the alternate sheet explanation', () => {
    const html = renderBanner(
      'zh-CN',
      <SheetStalenessBanners
        entityType="character"
        divergentVariantId="synthetic-variant"
      />
    );
    expect(html).toContain('备选设定图是根据当时的内容和设置生成的。');
    expect(html).not.toContain('备选sheet');
  });

  it('translates the owning sequence in the music alternate accessible name', () => {
    const html = renderBanner(
      'zh-CN',
      <DivergentAlternateBanner
        variantId="synthetic-variant"
        artifact="music"
        entityType="sequence"
        density="corner-dot"
      />
    );
    expect(html).toContain('aria-label="此作品有可供对比的备选配乐"');
  });
});
