import type { Locale } from '@/platform/i18n/locale';
import { localizedPrompt } from '@/platform/i18n/prompt-locale';

export function boundaryRepairPrompt(
  quotes: readonly string[],
  locale: Locale
) {
  return (
    localizedPrompt(
      locale,
      'Some of your boundary quotes could not be located verbatim in the script and were discarded:\n',
      '部分场景边界引文无法在剧本中逐字定位，已被舍弃：\n'
    ) +
    quotes.map((quote) => `- ${JSON.stringify(quote)}`).join('\n') +
    localizedPrompt(
      locale,
      '\n\nRe-emit the COMPLETE result. Every quote must be copied character-for-character from the script (no line-number gutter, no paraphrasing, no smart-quote substitution), in script order.',
      '\n\n重新输出完整结果。所有引文必须按剧本顺序逐字复制，不能包含行号栏、改写或替换引号。'
    )
  );
}
