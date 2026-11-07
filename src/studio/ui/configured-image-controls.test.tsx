import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import type { Locale } from '@/platform/i18n/locale';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  ConfiguredImageEstimate,
  ConfiguredImageStatus,
} from './configured-image-controls';
import { evaluateStudioImageSettings } from './configured-image-settings';
import type { ConfiguredImageControls as ImageControls } from './use-configured-image-controls';

const preferences = vi.hoisted(() => ({ showCosts: true }));
vi.mock('@/billing/ui/use-show-costs', () => ({
  useShowCosts: () => ({ showCosts: preferences.showCosts }),
}));

function makeControls(
  overrides: Partial<ImageControls> = {},
  unitPriceUsd = 0.1
): ImageControls {
  const model = imageCatalogFixture({
    priceCards: [
      { id: 'generate', operation: 'generate', match: {}, unitPriceUsd },
    ],
  });
  return {
    ...evaluateStudioImageSettings({
      modelId: model.id,
      catalog: mergeImageModelCatalog([model]),
      referenceCount: 0,
      aspectRatio: '1:1',
      resolution: '720p',
      totalImageCount: overrides.totalImageCount ?? 1,
    }),
    maskInput: '',
    setMaskImageUrl: vi.fn(),
    chooseMaskFile: vi.fn(),
    uploadingMask: false,
    clearMask: vi.fn(),
    reset: vi.fn(),
    restore: vi.fn(),
    ...overrides,
  } satisfies ImageControls;
}

function renderUi(children: ReactNode, locale: Locale = 'en') {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      {children}
    </I18nextProvider>
  );
}

beforeEach(() => {
  preferences.showCosts = true;
});

describe('Configured image estimate placement and display', () => {
  const locales: { locale: Locale; description: string }[] = [
    {
      locale: 'en',
      description: 'Estimated cost about $0.40',
    },
    {
      locale: 'zh-CN',
      description: '预计费用约为 $0.40',
    },
  ];

  it.each(locales)(
    'shows only the prepared total with its accessible label in $locale',
    ({ locale, description }) => {
      const controls = makeControls({ totalImageCount: 4 });
      expect(controls.issue).toBeNull();
      const html = renderUi(
        <ConfiguredImageEstimate controls={controls} />,
        locale
      );
      expect(html).toContain('>~$0.40</output>');
      expect(html).toContain(`aria-label="${description}"`);
      expect(html).toContain('aria-live="polite"');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('tooltip');
      expect(html).not.toContain('title=');
      expect(html).not.toContain('×');
    }
  );

  it('keeps microdollar estimates visible without rounding them to zero', () => {
    const controls = makeControls({}, 0.000001);
    const html = renderUi(<ConfiguredImageEstimate controls={controls} />);
    expect(html).toContain('>~$0.000001</output>');
    expect(html).toContain('aria-label="Estimated cost about $0.000001"');
  });

  it('leaves the status area empty for valid configured prices', () => {
    const controls = makeControls();
    expect(controls.issue).toBeNull();
    expect(renderUi(<ConfiguredImageStatus controls={controls} />)).toBe('');
  });

  it('hides the estimate when costs are disabled', () => {
    preferences.showCosts = false;
    const controls = makeControls();
    expect(renderUi(<ConfiguredImageEstimate controls={controls} />)).toBe('');
  });

  const unavailable: { name: string; overrides: Partial<ImageControls> }[] = [
    { name: 'a builtin model', overrides: { isConfigured: false } },
    { name: 'a missing price quote', overrides: { quote: null } },
    { name: 'a missing total', overrides: { estimate: null } },
    {
      name: 'a control issue',
      overrides: { issue: { key: 'Choose a verified image size.' } },
    },
  ];

  it.each(unavailable)('hides the estimate for $name', ({ overrides }) => {
    const controls = makeControls(overrides);
    expect(renderUi(<ConfiguredImageEstimate controls={controls} />)).toBe('');
  });

  it('keeps translated issues visible when costs are disabled', () => {
    preferences.showCosts = false;
    const controls = makeControls({
      issue: { key: 'Choose a verified image size.' },
    });
    const html = renderUi(
      <ConfiguredImageStatus controls={controls} />,
      'zh-CN'
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('选择已验证的图片尺寸。');
    expect(html).not.toContain('~$');
  });
});
