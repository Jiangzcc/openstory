import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ANALYSIS_MODEL,
  getAnalysisModelById,
} from '@/models/models.config';
import type { Locale } from '@/platform/i18n/locale';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { asStub } from '@/test/as-stub';
import type { SequenceWithShots } from '../use-sequences-with-shots';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 248,
    measureElement: () => undefined,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    to: _to,
    ...props
  }: ComponentProps<'a'> & { to: string; params: { id: string } }) => (
    <a {...props} href={`/sequences/${params.id}/scenes`}>
      {children}
    </a>
  ),
}));
vi.mock('@/shots/ui/use-scenes', () => ({
  useScenesBySequence: () => ({ data: [] }),
}));
vi.mock('./eval-scene-cell', () => ({ EvalSceneCell: () => null }));
vi.mock('./eval-sequence-metadata', () => ({
  SequenceListStatus: () => null,
}));

const { EvalSequencesMobile } = await import('./eval-sequences-mobile');

function renderReel(locale: Locale, posterUrl: string | null = null) {
  const sequence = asStub<SequenceWithShots>({
    id: '01J00000000000000000000000',
    title: 'Untouched story title',
    analysisModel: DEFAULT_ANALYSIS_MODEL,
    aspectRatio: '16:9',
    posterUrl,
    shots: [],
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <EvalSequencesMobile
        sequences={[sequence]}
        viewMode="images"
        shotsLoadingMap={{}}
      />
    </I18nextProvider>
  );
}

describe('mobile reel poster', () => {
  it.each([
    ['en', 'No preview yet'],
    ['zh-CN', '暂无预览'],
  ] as const)(
    'keeps the model badge as an element without a preview in %s',
    (locale, emptyLabel) => {
      const html = renderReel(locale);
      const model = getAnalysisModelById(DEFAULT_ANALYSIS_MODEL);
      expect(model).toBeDefined();
      expect(html).toContain(emptyLabel);
      expect(html).toMatch(new RegExp(`<span[^>]*>${model?.name}</span>`));
      expect(html).toContain('Untouched story title');
      expect(html).toContain('/sequences/01J00000000000000000000000/scenes');
      expect(html).not.toContain('[object Object]');
    }
  );

  it.each(['en', 'zh-CN'] as const)(
    'keeps the preview image and model badge in %s',
    (locale) => {
      const html = renderReel(locale, '/r2/poster.png');
      const model = getAnalysisModelById(DEFAULT_ANALYSIS_MODEL);
      expect(html).toContain('src="/r2/poster.png"');
      expect(html).toMatch(new RegExp(`<span[^>]*>${model?.name}</span>`));
      expect(html).not.toContain('[object Object]');
    }
  );
});
