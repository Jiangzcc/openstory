import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/platform/i18n/locale';
import type { GeneratedAsset } from '@/platform/server/db/schema';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import type { StudioLibrary } from './studio-reference-picker';
import {
  StudioReferencePicker,
  useStudioLibrary,
} from './studio-reference-picker';

const assets = vi.hoisted(
  () =>
    [
      {
        id: '01M6T2K6K2H9Q0Z7GQ7W3Q5T10',
        activity: 'image',
        status: 'completed',
        input: { prompt: '' },
        outputs: [{ url: '/r2/empty.png', contentType: 'image/png' }],
      },
      {
        id: '01M6T2K6K2H9Q0Z7GQ7W3Q5T11',
        activity: 'image',
        status: 'completed',
        input: { prompt: 'Generation' },
        outputs: [{ url: '/r2/prompt.png', contentType: 'image/png' }],
      },
    ] satisfies Pick<
      GeneratedAsset,
      'id' | 'activity' | 'status' | 'input' | 'outputs'
    >[]
);

// Data hooks and the Dialog portal are mocks; copy, translations and library mapping execute.
vi.mock('@/ui/shadcn/dialog', () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});
vi.mock('@/platform/ui/auth/session-query', () => ({
  useAuthSession: () => ({ data: { user: { id: 'mock-user' } } }),
}));
vi.mock('@/cast/ui/use-organization-characters', () => ({
  useLibraryCharacters: () => ({
    data: [{ name: 'Characters', sheetImageUrl: '/r2/character.png' }],
  }),
}));
vi.mock('@/cast/ui/use-organization-locations', () => ({
  useOrganizationLocationList: () => ({
    data: [{ name: 'Locations', referenceImageUrl: '/r2/location.png' }],
  }),
}));
vi.mock('@/cast/ui/use-sequence-characters', () => ({
  useSequenceCharacters: () => ({ data: [] }),
}));
vi.mock('@/cast/ui/use-sequence-elements', () => ({
  useSequenceElements: () => ({ data: [] }),
}));
vi.mock('@/cast/ui/use-sequence-locations', () => ({
  useSequenceLocations: () => ({ data: [] }),
}));
vi.mock('@/sequences/ui/use-sequences-with-shots', () => ({
  useSequencesWithShots: () => ({
    data: [{ id: 'mock-sequence', title: 'Sequences', shots: [] }],
  }),
}));
vi.mock('./use-studio-assets', () => ({
  useStudioAssets: ({ activity }: { activity: string }) => ({
    data: { pages: [{ assets: activity === 'image' ? assets : [] }] },
  }),
  useStudioUploads: () => ({
    data: [{ url: '/r2/upload.png', label: 'Uploads', kind: 'image' }],
  }),
}));

const EMPTY_LIBRARY: StudioLibrary = {
  generations: [],
  uploads: [],
  sequences: [],
  cast: [],
  locations: [],
};

function renderPicker(
  locale: Locale,
  overrides: Partial<ComponentProps<typeof StudioReferencePicker>> = {}
) {
  const i18n = createApplicationI18n(locale);
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StudioReferencePicker
        open
        onOpenChange={() => undefined}
        title={i18n.t('Add reference', { ns: 'studio' })}
        library={EMPTY_LIBRARY}
        attached={[]}
        multiple
        slots={{ image: 3, video: 2, audio: 1 }}
        onPick={() => undefined}
        onUpload={() => undefined}
        {...overrides}
      />
    </I18nextProvider>
  );
}

function renderLibrary(locale: Locale) {
  const snapshots: StudioLibrary[] = [];
  function CaptureLibrary() {
    snapshots.push(useStudioLibrary());
    return null;
  }
  renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <CaptureLibrary />
    </I18nextProvider>
  );
  const result = snapshots[0];
  if (!result) throw new Error('Missing rendered library');
  return result;
}

const locales: Locale[] = ['zh-CN', 'en'];

describe('reference picker localization', () => {
  it.each(locales)(
    'translates source navigation and the empty state in %s',
    (locale) => {
      const html = renderPicker(locale);
      const labels =
        locale === 'zh-CN'
          ? ['生成记录', '上传素材', '作品', '角色', '地点', '音频', '绘图']
          : [
              'Generations',
              'Uploads',
              'Sequences',
              'Characters',
              'Locations',
              'Audio',
              'Draw',
            ];
      for (const label of labels) expect(html).toContain(`>${label}<`);
      expect(html).toContain(
        locale === 'zh-CN'
          ? '还没有生成素材。'
          : 'No generations yet — make an image or clip and it shows up here.'
      );
    }
  );

  it.each(locales)(
    'localizes all media counts in the description in %s',
    (locale) => {
      const html = renderPicker(locale);
      if (locale === 'zh-CN') {
        expect(html).toContain('3 张图片');
        expect(html).toContain('2 段视频');
        expect(html).toContain('1 段音频');
        expect(html).not.toContain('2 clips');
        expect(html).not.toContain('1 audio');
      } else {
        expect(html).toContain(
          'Up to 3 stills, 2 clips, 1 audio. Upload or paste.'
        );
      }
    }
  );

  it.each(locales)(
    'preserves a user label identical to a source key in %s',
    (locale) => {
      const html = renderPicker(locale, {
        library: {
          ...EMPTY_LIBRARY,
          generations: [
            { url: '/r2/user.png', label: 'Characters', kind: 'image' },
          ],
        },
      });
      expect(html).toContain('aria-label="Characters"');
      expect(html).toContain('title="Characters"');
      expect(html).not.toContain('aria-label="角色"');
    }
  );

  it.each(locales)(
    'localizes only generated fallback labels in the library in %s',
    (locale) => {
      const library = renderLibrary(locale);
      expect(library.generations.map((reference) => reference.label)).toEqual([
        locale === 'zh-CN' ? '生成记录' : 'Generation',
        'Generation',
      ]);
      expect(library.uploads[0]?.label).toBe('Uploads');
      expect(library.sequences[0]?.title).toBe('Sequences');
      expect(library.cast[0]?.label).toBe('Characters');
      expect(library.cast[0]?.alias).toBe('Characters');
      expect(library.locations[0]?.label).toBe('Locations');
      expect(library.locations[0]?.alias).toBe('Locations');
    }
  );
});
