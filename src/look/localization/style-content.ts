import type { Locale } from '@/platform/i18n/locale';
import { parseStyleConfig, StyleConfigSchema } from '@/look/style-config';
import type { StyleConfig } from '@/look/style-config';
import lookA from './locales/zh-CN/style-content-look-a.json';
import lookB from './locales/zh-CN/style-content-look-b.json';
import lookC from './locales/zh-CN/style-content-look-c.json';
import references from './locales/zh-CN/style-content-references.json';
import tags from './locales/zh-CN/style-content-tags.json';

const chineseContent: Readonly<Record<string, string>> = {
  ...lookA,
  ...lookB,
  ...lookC,
  ...references,
  ...tags,
};

export function translateStyleContent(source: string, locale: Locale): string {
  return locale === 'zh-CN' && Object.hasOwn(chineseContent, source)
    ? (chineseContent[source] ?? source)
    : source;
}

export function localizeTemplateStyleConfig(
  style: { isTemplate: boolean | null; config: unknown },
  locale: Locale
): StyleConfig {
  const config = parseStyleConfig(style.config);
  if (style.isTemplate !== true || locale === 'en') return config;
  const translate = (source: string) => translateStyleContent(source, locale);
  return StyleConfigSchema.parse({
    ...config,
    look: {
      ...config.look,
      mood: translate(config.look.mood),
      artStyle: translate(config.look.artStyle),
      lighting: translate(config.look.lighting),
      colorGrading: translate(config.look.colorGrading),
      ...(config.look.medium && { medium: translate(config.look.medium) }),
    },
    motion: {
      ...config.motion,
      camera: translate(config.motion.camera),
      ...(config.motion.shots && { shots: translate(config.motion.shots) }),
    },
    references: config.references.map(translate),
  });
}
