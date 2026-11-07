import { AUDIO_CHAT_PROMPTS_ZH_CN } from './audio';
import { CAST_CHAT_PROMPTS_ZH_CN } from './cast';
import { REWRITE_CHAT_PROMPTS_ZH_CN } from './rewrite';
import { SCENE_CHAT_PROMPTS_ZH_CN } from './scenes';

export { TEXT_PROMPTS_ZH_CN } from './text';

export const CHAT_PROMPTS_ZH_CN = {
  ...AUDIO_CHAT_PROMPTS_ZH_CN,
  ...CAST_CHAT_PROMPTS_ZH_CN,
  ...REWRITE_CHAT_PROMPTS_ZH_CN,
  ...SCENE_CHAT_PROMPTS_ZH_CN,
};
