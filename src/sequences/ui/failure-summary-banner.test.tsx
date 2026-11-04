import { CONTENT_REJECTION_USER_HINT } from '@/models/content-rejection';
import { CREDITS_SHORT_TITLE } from '@/billing/credits-short';
import type { FailureSummary } from '@/sequences/failure-analysis';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { describe, expect, it, vi } from 'vitest';
import { FailureSummaryBanner } from './failure-summary-banner';

// Mock routing so this regression checks the displayed label without navigation.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="#shot">{children}</a>
  ),
}));

const contentSummary: FailureSummary = {
  requiresFullRetry: true,
  headline:
    "Harry Potter didn't pass the content checker \u2014 regenerate to retry",
  groups: [],
  totalFailures: 1,
  hasFailed: true,
  error: 'Blocked by the content checker: Harry Potter',
  tone: 'warning',
};

const creditsSummary: FailureSummary = {
  requiresFullRetry: true,
  headline: CREDITS_SHORT_TITLE,
  groups: [],
  totalFailures: 1,
  hasFailed: true,
  error:
    'Not enough credits to generate images for 11 scenes. Add $4.20 more, then continue.',
  tone: 'credits',
};

const generationFailed: FailureSummary = {
  requiresFullRetry: true,
  headline: 'Generation failed — regenerate to retry',
  groups: [],
  totalFailures: 1,
  hasFailed: true,
  error: 'Workflow timed out while generating scene prompts',
  tone: 'error',
};

describe('FailureSummaryBanner', () => {
  it.each([
    ['zh-CN', 'Scene 2', '场景 2 · 镜头 3'],
    ['en', 'Scene 2', 'Scene 2 · Shot 3'],
    ['zh-CN', 'Night of Summer', '场景 2（Night of Summer） · 镜头 3'],
    ['zh-CN', '场景 2', '场景 2（场景 2） · 镜头 3'],
  ] as const)(
    'renders %s shot labels for %s',
    (locale, sceneTitle, expected) => {
      const summary: FailureSummary = {
        ...generationFailed,
        groups: [
          {
            category: 'image',
            label: 'Images',
            shots: [
              {
                shotId: 'mock-shot',
                sceneNumber: 2,
                sceneTitle,
                shotNumber: 3,
                error: 'Mock generation failure',
              },
            ],
          },
        ],
      };
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={createApplicationI18n(locale)}>
          <FailureSummaryBanner
            summary={summary}
            onRetry={() => undefined}
            isRetrying={false}
          />
        </I18nextProvider>
      );
      expect(html).toContain(expected);
    }
  );

  it('SSRs the content-checker title instead of Generation failed', () => {
    const html = renderToStaticMarkup(
      <FailureSummaryBanner
        summary={contentSummary}
        onRetry={() => undefined}
        isRetrying={false}
      />
    );

    expect(html).toContain('Content checker');
    expect(html).toContain('pass the content checker');
    expect(html).toContain('regenerate to retry');
    expect(html).toContain(CONTENT_REJECTION_USER_HINT);
    expect(html).not.toContain('Generation failed');
  });

  it('SSRs a top-up prompt instead of Generation failed (#1328)', () => {
    const html = renderToStaticMarkup(
      <FailureSummaryBanner
        summary={creditsSummary}
        onRetry={() => undefined}
        isRetrying={false}
      />
    );

    expect(html).toContain(CREDITS_SHORT_TITLE);
    expect(html).toContain('This sequence has 11 scenes');
    expect(html).toContain('Add $4.20 more');
    expect(html).toContain('Add credits');
    expect(html).toContain('Continue generation');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Generation failed');
    expect(html).not.toContain('full retry required');
    expect(html).not.toContain('Regenerate Sequence');
    expect(html).not.toContain('text-destructive');
    expect(html).not.toContain('font-mono');
  });

  it('SSRs error-tone retry while mobile starts collapsed', () => {
    const html = renderToStaticMarkup(
      <FailureSummaryBanner
        summary={generationFailed}
        onRetry={() => undefined}
        onFullRetry={() => undefined}
        isRetrying={false}
      />
    );

    expect(html).toContain('Generation failed');
    expect(html).toContain('Workflow timed out');
    expect(html).toContain('Regenerate Sequence');
    expect(html).toContain('Show details');
    expect(html).toContain('aria-expanded="false"');
  });
});
