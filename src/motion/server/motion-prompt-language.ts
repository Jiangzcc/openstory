import type { Locale } from '@/platform/i18n/locale';

const CHINESE_MOTION_TEXT: Record<string, string> = {
  'No BGM, no music. Generate only dialogue, environmental sounds, and action sounds.':
    '不要背景音乐或配乐。只生成对白、环境声和动作音效。',
  'No BGM, no music, no dialogue. Generate only environmental sounds and action sounds.':
    '不要背景音乐、配乐或对白。只生成环境声和动作音效。',
  'No BGM; generate only environmental sounds and action sounds.':
    '不要背景音乐；只生成环境声和动作音效。',
  'Silent. No dialogue, no sound effects, no music.':
    '保持静音。不要对白、音效或音乐。',
  'Single unbroken scene.': '保持单一连续场景，不中断。',
  'Single continuous shot, no cuts.': '保持单个连续镜头，不要切镜。',
  'Avoid jitter and bent limbs.': '避免画面抖动和肢体异常弯曲。',
  'Exact master audio track; preserve word-for-word delivery, exact vocal timbre, room tone, and sound effects completely intact. Do not replace, remix, or add underlying music.':
    '以此作为精确的音频主轨；逐字保留原有演绎、准确音色、空间底噪和音效，完整不变。不要替换或重新混音，也不要添加背景音乐。',
  'Ambient sounds': '环境声音',
  Audio: '音频',
  Narrator: '旁白',
  'A voice': '一个声音',
  'Immediately, ': '紧接着，',
};

/** Translate authored directions without touching dialogue, sound cues, or provider tokens. */
export function motionPromptText(source: string, locale: Locale): string {
  return locale === 'zh-CN' ? (CHINESE_MOTION_TEXT[source] ?? source) : source;
}
