import { getDefaults } from 'react-i18next';

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '{': '&#123;',
  '}': '&#125;',
};

export function escapeRichTextValue(value: string) {
  return value.replace(
    /[&<>"'/{}]/g,
    (character) => ENTITIES[character] ?? character
  );
}

export function unescapeRichTextValue(value: string) {
  const braces = value.replace(/&#(?:123|125);/g, (entity) =>
    entity === '&#123;' ? '{' : '}'
  );
  return getDefaults().unescape?.(braces) ?? braces;
}
