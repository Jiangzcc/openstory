import { briefForStyle } from '@/look/brief-for-style';
import { translateStyleSample } from '@/look/localization/style-samples';
import { sampleScriptForStyle } from './composer-sample';
import type { Locale } from '@/platform/i18n/locale';

type SampleStyle = {
  name: string;
  category: string | null;
  isTemplate: boolean | null;
};

export function canonicalStyleSample(style: SampleStyle, locale: Locale) {
  const source = briefForStyle(style);
  return style.isTemplate ? translateStyleSample(source, locale) : source;
}

export function localizedStyleSample(
  style: SampleStyle,
  locale: Locale,
  random: () => number = Math.random
) {
  const source = sampleScriptForStyle(style, random);
  return source && style.isTemplate
    ? translateStyleSample(source, locale)
    : source;
}
