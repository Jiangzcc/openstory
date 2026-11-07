import { describe, expect, it } from 'vitest';
import { getChatPrompt, getPrompt } from '../prompts-index';
import {
  WORKFLOW_CHAT_PROMPTS,
  WORKFLOW_TEXT_PROMPTS,
} from '../workflow-prompts';
import { CHAT_PROMPTS_ZH_CN, TEXT_PROMPTS_ZH_CN } from './zh-CN';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';

const compareStrings = (left: string, right: string) =>
  left.localeCompare(right);

function variablesIn(template: string) {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort(compareStrings);
}

function referenceTagsIn(template: string) {
  return [...template.matchAll(/<\/?[A-Z_]+>/g)]
    .map((match) => match[0])
    .sort(compareStrings);
}

describe('bilingual workflow prompt catalog', () => {
  it('covers every registered text and chat template', () => {
    expect(Object.keys(TEXT_PROMPTS_ZH_CN).sort(compareStrings)).toEqual(
      Object.keys(WORKFLOW_TEXT_PROMPTS).sort(compareStrings)
    );
    expect(Object.keys(CHAT_PROMPTS_ZH_CN).sort(compareStrings)).toEqual(
      Object.keys(WORKFLOW_CHAT_PROMPTS).sort(compareStrings)
    );
    expect(Object.keys(TEXT_PROMPTS_ZH_CN)).toHaveLength(3);
    expect(Object.keys(CHAT_PROMPTS_ZH_CN)).toHaveLength(16);
  });

  it.each(Object.entries(WORKFLOW_TEXT_PROMPTS))(
    '%s preserves text variables and selects the actual language resource',
    async (name, english) => {
      const chinese = TEXT_PROMPTS_ZH_CN[name] ?? '';
      expect(chinese).toMatch(/[\u4e00-\u9fff]/);
      expect(variablesIn(chinese)).toEqual(variablesIn(english));
      expect(referenceTagsIn(chinese)).toEqual(referenceTagsIn(english));
      expect(await getPrompt(name, undefined, 'en')).toEqual({
        compiled: english,
      });
      expect(await getPrompt(name, undefined, 'zh-CN')).toEqual({
        compiled: chinese,
      });
    }
  );

  it.each(Object.entries(WORKFLOW_CHAT_PROMPTS))(
    '%s preserves message roles, variables and reference tags',
    async (name, english) => {
      const chinese = CHAT_PROMPTS_ZH_CN[name] ?? [];
      expect(chinese.map((message) => message.role)).toEqual(
        english.map((message) => message.role)
      );
      for (const [index, message] of english.entries()) {
        const translation = chinese[index]?.content ?? '';
        expect(translation).toMatch(/[\u4e00-\u9fff]/);
        expect(variablesIn(translation)).toEqual(variablesIn(message.content));
        expect(referenceTagsIn(translation)).toEqual(
          referenceTagsIn(message.content)
        );
      }
      expect(await getChatPrompt(name, undefined, 'en')).toEqual({
        messages: english,
      });
      expect(await getChatPrompt(name, undefined, 'zh-CN')).toEqual({
        messages: chinese,
      });
    }
  );

  it('keeps user text, dialogue, references and embedded braces unchanged', async () => {
    const original = `中文对白 "Don't translate me." BONDI_SCREEN {{untouched}}`;
    const { messages } = await getChatPrompt(
      'phase/soften-motion-prompt-chat',
      { prompt: original, rejection: 'unexpected result' },
      'zh-CN'
    );
    expect(messages[1]?.content).toContain(original);
    expect(messages[1]?.content).toContain('<ORIGINAL_PROMPT>');
    expect(messages[1]?.content).toContain('unexpected result');
    expect(messages[0]?.content).toContain('语法正确的中文');
    expect(messages[0]?.content).toContain('自由描述使用简体中文');
    expect(messages[0]?.content).toContain('原样保留全大写角色名');
  });

  it('preserves the machine-readable duration format in Chinese', async () => {
    const { compiled } = await getPrompt(
      'script/enhance',
      { userCountry: 'AU' },
      'zh-CN'
    );
    expect(compiled).toContain('Scene 2 — 12s');
    expect(compiled).toContain('TOTAL: <sum>s');
    expect(compiled).toContain('Shot N — Xs');
    expect(compiled).toContain('不要为了匹配用户而迁移发生在别处的故事');
    expect(compiled).toContain('用户国家（ISO 国家代码；空值表示不可用）：AU');
  });

  it('preserves shot vocabulary, dialogue identity and timing rules', () => {
    const chinese =
      CHAT_PROMPTS_ZH_CN['phase/scene-shot-list-chat']?.[0]?.content;
    expect(chinese).toContain('extreme wide、wide、medium wide');
    expect(chinese).toContain('eye level、low angle、high angle');
    expect(chinese).toContain('准确复制 <CHARACTERS>');
    expect(chinese).toContain('逐字复制的实际话语');
    expect(chinese).toContain('每秒 {{dialogueWordsPerSecond}} 词');
    expect(chinese).toContain('不要虚构供应商语法');
  });

  it('keeps native voice and instrumental output requirements', () => {
    const voice = CHAT_PROMPTS_ZH_CN['phase/voice-design-chat']?.[0]?.content;
    const range =
      CHAT_PROMPTS_ZH_CN['phase/voice-range-script-chat']?.[0]?.content;
    const music = CHAT_PROMPTS_ZH_CN['phase/music-design-chat']?.[0]?.content;
    expect(voice).toContain('Excellent quality');
    expect(voice).toContain('Native Australian English');
    expect(range).toContain('只使用正常英语拼写');
    expect(music).toContain('第一个标签必须始终为“instrumental”');
    expect(music).toContain('vocal、singing、lyrics');
  });

  it('isolates concurrent calls without mutating either catalog', async () => {
    const name = 'phase/scene-splitting-boundaries-chat';
    const [chinese, english] = await Promise.all([
      getChatPrompt(name, { script: '中文故事' }, 'zh-CN'),
      getChatPrompt(name, { script: 'English story' }, 'en'),
    ]);
    expect(chinese.messages[0]?.content).toContain('你是剧本场景分析师');
    expect(english.messages[0]?.content).toContain(
      'You are a Script Scene Analyzer'
    );
    expect(chinese.messages[1]?.content).toContain('中文故事');
    expect(chinese.messages[1]?.content).not.toContain('English story');
    expect(english.messages[1]?.content).toContain('English story');
    expect(CHAT_PROMPTS_ZH_CN[name]?.[1]?.content).toContain('{{script}}');
    expect(WORKFLOW_CHAT_PROMPTS[name]?.[1]?.content).toContain('{{script}}');
  });

  it('rejects unknown templates in either language', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      await expect(getPrompt('missing', undefined, locale)).rejects.toThrow(
        'Text prompt "missing" not found'
      );
      await expect(getChatPrompt('missing', undefined, locale)).rejects.toThrow(
        'Chat prompt "missing" not found'
      );
    }
  });
});
