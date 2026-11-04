import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

const FENCE_START = /^\s*(`{3,}|~{3,})/;

export function markdownSegments(source: string) {
  const segments: Array<{ text: string; prose: boolean }> = [];
  let buffer: string[] = [];
  let fence = '';
  const flush = (prose: boolean) => {
    if (buffer.length) segments.push({ text: buffer.join('\n'), prose });
    buffer = [];
  };
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const marker = FENCE_START.exec(line)?.[1];
    if (fence) {
      buffer.push(line);
      if (marker?.startsWith(fence[0] ?? '') && marker.length >= fence.length) {
        flush(false);
        fence = '';
      }
    } else if (marker) {
      flush(true);
      fence = marker;
      buffer.push(line);
    } else if (!line.trim()) {
      flush(true);
      segments.push({ text: line, prose: false });
    } else buffer.push(line);
  }
  flush(!fence);
  return segments;
}

export function localizeMarkdown(
  i18n: I18n,
  source: string,
  locale = i18n.resolvedLanguage
) {
  return markdownSegments(source)
    .map(({ text, prose }) =>
      prose ? translateStaticLabel(i18n, 'guide', text, locale) : text
    )
    .join('\n');
}
