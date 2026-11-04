import { useEffect } from 'react';
import { useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { translateMarkedHeadText } from './head';

function updateMetaContent(name: string, content: string) {
  for (const element of document.head.querySelectorAll('meta')) {
    const elementName =
      element.getAttribute('name') ?? element.getAttribute('property');
    if (elementName === name) element.setAttribute('content', content);
  }
}

export function LocalizedHead() {
  const matches = useMatches();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  useEffect(() => {
    const entries = matches.flatMap((match) => match.meta ?? []);
    for (const entry of entries) {
      if (!entry) continue;
      const translated = translateMarkedHeadText(i18n, entry);
      if (translated === undefined) continue;
      if (typeof entry.title === 'string') document.title = translated;
      const name = entry.name ?? entry.property;
      if (typeof name === 'string') updateMetaContent(name, translated);
    }
  }, [i18n, locale, matches]);
  return null;
}
