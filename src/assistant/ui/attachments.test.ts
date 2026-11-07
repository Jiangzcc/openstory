import { describe, expect, it } from 'vitest';
import type { Locale } from '@/platform/i18n/locale';
import { messageContent, type Attachment } from './attachments';

const body = 'Lena says "Stay here." 然后走开。';
const attached: Attachment[] = [
  {
    id: 'attachment',
    name: 'Lena 的剧本.txt',
    kind: 'text',
    mimeType: 'text/plain',
    status: 'ready',
    text: body,
    upload: '/r2/organization/unchanged.txt',
  },
];
const cases = [
  { locale: 'zh-CN', label: '附加的上传素材' },
  { locale: 'en', label: 'Attached uploads' },
] satisfies { locale: Locale; label: string }[];

describe('assistant attachment prompt language', () => {
  it.each(cases)(
    'uses $locale instructions and preserves attachment data',
    ({ locale, label }) => {
      const content = messageContent('Please read 原文。', attached, locale);
      expect(content).toEqual({
        content: [
          {
            type: 'text',
            content: expect.stringContaining(label),
          },
        ],
      });
      const serialized = JSON.stringify(content);
      expect(serialized).toContain('Please read 原文。');
      expect(serialized).toContain('Lena 的剧本.txt');
      expect(serialized).toContain('/r2/organization/unchanged.txt');
      expect(serialized).toContain(JSON.stringify(body).slice(1, -1));
      expect(serialized).toContain('set_*_from_upload');
    }
  );
});
