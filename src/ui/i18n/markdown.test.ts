import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { parseDocsMarkdown } from '@/ui/docs/markdown-ast';
import { applicationResources } from './resources';
import { createApplicationI18n } from './runtime';
import { localizeMarkdown, markdownSegments } from './markdown';

function filesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return filesIn(child);
    return entry.name.endsWith('.md') ? [child] : [];
  });
}
const docs = [
  'getting-started.md',
  ...['user-guide', 'developer-guide', 'deployment', 'support'].flatMap(
    (root) => filesIn(join('docs', root)).map((file) => file.slice(5))
  ),
];
const links = (text: string) =>
  [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1] ?? '')
    .sort((left, right) => left.localeCompare(right));

describe('localized help content', () => {
  it.each(docs)(
    'covers prose and preserves fences, links and anchors: %s',
    (file) => {
      const source = matter(
        readFileSync(join('docs', file), 'utf8')
      ).content.replaceAll('\r\n', '\n');
      const i18n = createApplicationI18n();
      for (const segment of markdownSegments(source).filter(
        (segment) => segment.prose
      )) {
        expect(
          Object.hasOwn(applicationResources['zh-CN'].guide, segment.text),
          segment.text
        ).toBe(true);
      }
      const translated = localizeMarkdown(i18n, source);
      expect(
        markdownSegments(translated)
          .filter((s) => !s.prose && s.text.trim())
          .map((s) => s.text)
      ).toEqual(
        markdownSegments(source)
          .filter((s) => !s.prose && s.text.trim())
          .map((s) => s.text)
      );
      expect(links(translated)).toEqual(links(source));
      const original = parseDocsMarkdown(source);
      const localized = parseDocsMarkdown(
        translated,
        original.headings.map((heading) => heading.id)
      );
      expect(localized.headings.map((heading) => heading.id)).toEqual(
        original.headings.map((heading) => heading.id)
      );
      expect(localizeMarkdown(createApplicationI18n('en'), source)).toBe(
        source
      );
    }
  );
  it('uses explicit locale for memoized text without mutating the instance', () => {
    const i18n = createApplicationI18n('en');
    expect(localizeMarkdown(i18n, '## Authentication', 'zh-CN')).toBe(
      '## 身份认证'
    );
    expect(i18n.language).toBe('en');
  });
});
