import type { MentionItem } from '@/shots/ui/prompt-mention/mention-items';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { MentionList } from './mention-list';

const items: MentionItem[] = [
  {
    id: 'reference',
    section: 'references',
    label: 'User attachment',
    tag: 'Image1',
    haystack: 'attachment',
  },
  {
    id: 'element',
    section: 'elements',
    label: 'Cast',
    tag: 'USER_TOKEN',
    haystack: 'cast',
  },
  {
    id: 'library',
    section: 'cast',
    label: 'Locations',
    sublabel: 'Add to this sequence',
    tag: 'ORIGINAL_HERO',
    haystack: 'locations',
    pickOnly: true,
  },
  {
    id: 'location',
    section: 'locations',
    label: 'User place',
    sublabel: 'Add to this sequence',
    tag: 'ORIGINAL_PLACE',
    haystack: 'place',
  },
];

function renderList(locale: 'zh-CN' | 'en', entries = items) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <MentionList items={entries} command={vi.fn()} />
    </I18nextProvider>
  );
}

describe('mention list localization', () => {
  it('localizes catalog sections and the library attach action', () => {
    const html = renderList('zh-CN');
    for (const label of ['已附加', '元素', '角色', '地点']) {
      expect(html).toContain('>' + label + '</div>');
    }
    expect(html).toContain('添加到此作品');
  });

  it('preserves user names, ordinary sublabels and canonical prompt tags', () => {
    const html = renderList('zh-CN');
    for (const original of [
      'Cast',
      'Locations',
      'Add to this sequence',
      'USER_TOKEN',
      'ORIGINAL_HERO',
      'ORIGINAL_PLACE',
    ]) {
      expect(html).toContain('>' + original + '</span>');
    }
  });

  it('keeps the original labels in English', () => {
    const html = renderList('en');
    for (const label of ['Attached', 'Elements', 'Cast', 'Locations']) {
      expect(html).toContain('>' + label + '</div>');
    }
    expect(html).not.toContain('添加到此作品');
  });

  it('localizes empty suggestions without adding selectable rows', () => {
    const html = renderList('zh-CN', []);
    expect(html).toContain('无匹配结果');
    expect(html).not.toContain('role="option"');
  });
});
