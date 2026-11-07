import { describe, expect, it } from 'vitest';
import type { AssemblableMotionPrompt } from '@/shots/scene-analysis.schema';
import type { StyleConfig } from '@/look/style-config';
import type { ImageToVideoModel } from '@/models/models';
import { DIALOGUE_CLIP_TOKEN } from '@/motion/dialogue-tts';
import {
  buildMotionShotPrompt,
  buildPackedMotionPrompt,
  packedSceneFromScene,
} from './build-motion-prompts';
import { buildMotionRender } from './build-motion-render';
import { resolveMotionPromptFromVersion } from './resolve-motion-prompt';
import { buildShotPromptPreview } from '@/shots/server/optimised-prompt-preview';

const spokenWords = 'Keep {this} exactly — 不要改写 @Ada。';
const motionPrompt: AssemblableMotionPrompt = {
  fullPrompt: '@Ada turns toward the door. 用户自写 Camera: {close-up}.',
  dialogue: {
    presence: true,
    lines: [{ character: '@Ada', line: spokenWords, tone: 'gentle' }],
  },
  audio: {
    ambientSound: 'User-written wind',
    soundEffects: ['metal {bell}'],
  },
};
const styleConfig: StyleConfig = {
  version: 2,
  look: {
    mood: 'quiet',
    artStyle: '用户自写 style',
    lighting: 'soft light',
    colorPalette: ['#112233'],
    colorGrading: 'cool shadows',
  },
  motion: { camera: 'locked camera' },
  references: [],
};

describe('motion prompt language', () => {
  it('localizes Seedance directions while preserving spoken text and audio delimiters', () => {
    const result = buildMotionShotPrompt({
      promptLocale: 'zh-CN',
      model: 'seedance_v2_5',
      motionPrompt,
      characterTags: ['@Ada'],
    });
    expect(result.startsWith(motionPrompt.fullPrompt)).toBe(true);
    expect(result).toContain(`@Ada以gentle的嗓音说：{${spokenWords}}`);
    expect(result).toContain('<metal {bell}>');
    expect(result).toContain('User-written wind.');
    expect(result).toContain(
      '不要背景音乐或配乐。只生成对白、环境声和动作音效。'
    );
    expect(result).toContain('保持单个连续镜头，不要切镜。');
    expect(result).toContain('避免画面抖动和肢体异常弯曲。');
  });

  it('keeps recorded dialogue as a master track without repeating its transcript', () => {
    const result = buildMotionShotPrompt({
      promptLocale: 'zh-CN',
      model: 'seedance_v2_5',
      motionPrompt: {
        ...motionPrompt,
        dialogue: {
          presence: true,
          lines: [
            {
              character: '@Ada',
              line: spokenWords,
              tone: '',
              voiceToken: DIALOGUE_CLIP_TOKEN,
            },
            {
              character: '@Ben',
              line: '第二句',
              tone: '',
              voiceToken: DIALOGUE_CLIP_TOKEN,
            },
          ],
        },
      },
    });
    expect(result).toContain(`${DIALOGUE_CLIP_TOKEN}: 以此作为精确的音频主轨`);
    expect(result).toContain(
      `将@Ada，然后@Ben的口型与${DIALOGUE_CLIP_TOKEN}同步，按此顺序。`
    );
    expect(result).not.toContain(spokenWords);
    expect(result).not.toContain('第二句');
  });

  it('preserves MiniMax wire labels and the existing dialogue language marker', () => {
    const result = buildMotionShotPrompt({
      promptLocale: 'zh-CN',
      model: 'minimax_h3_max',
      motionPrompt,
    });
    expect(result).toContain(`<d>[English] ${spokenWords}</d>`);
    expect(result).toContain('overall_soundscape: User-written wind.');
    expect(result).toContain('non_diegetic_music: N/A');
    expect(result).toContain('不要背景音乐或配乐');
  });

  it.each<ImageToVideoModel>([
    'minimax_h3_max',
    'kling_v4',
    'gemini_omni_flash',
    'grok_imagine_video_1_5',
  ])('localizes silence for %s without changing the authored base', (model) => {
    const result = buildMotionShotPrompt({
      promptLocale: 'zh-CN',
      model,
      motionPrompt,
      generateAudio: false,
    });
    expect(result.startsWith(motionPrompt.fullPrompt)).toBe(true);
    expect(result).toContain('保持静音。不要对白、音效或音乐。');
    expect(result).not.toContain(spokenWords);
    if (model === 'gemini_omni_flash')
      expect(result).toContain('保持单一连续场景，不中断。');
  });

  it('keeps packed timestamps, cuts and Kling durations as provider syntax', () => {
    const shots = [
      { durationSeconds: 2, motionPrompt },
      { durationSeconds: 3, motionPrompt },
    ];
    const timed = buildPackedMotionPrompt({
      promptLocale: 'zh-CN',
      model: 'seedance_v2_5',
      shots,
    });
    expect(timed.prompt).toContain('Shot 1 (0-2s):');
    expect(timed.prompt).toContain('Shot 2 (2-5s):');
    expect(timed.prompt).toContain('不要背景音乐；只生成环境声和动作音效。');
    expect(timed.prompt).not.toContain('Single continuous shot');
    const cuts = buildPackedMotionPrompt({
      promptLocale: 'zh-CN',
      model: 'seedance_v2',
      shots,
    });
    expect(cuts.prompt).toContain('\ncut to\nShot 2:');
    const kling = buildPackedMotionPrompt({
      promptLocale: 'zh-CN',
      model: 'kling_v4',
      shots,
    });
    expect(kling.multiPrompt?.map((shot) => shot.duration)).toEqual([2, 3]);
    expect(kling.maxElementLength).toBe(512);
    expect(kling.multiPrompt?.[0]?.prompt).toContain('不要背景音乐或配乐');
    expect(kling.multiPrompt?.[1]?.prompt).toContain(
      `[${'@Ada'}, gentle]: "${spokenWords}"`
    );
  });

  it.each<ImageToVideoModel>([
    'seedance_v2_5',
    'minimax_h3_max',
    'kling_v3_pro',
    'gemini_omni_flash',
  ])('keeps the default English builder byte-identical for %s', (model) => {
    const source = { model, motionPrompt, characterTags: ['@Ada'] };
    expect(buildMotionShotPrompt({ ...source, promptLocale: 'en' })).toBe(
      buildMotionShotPrompt(source)
    );
  });

  it('localizes only the natural-light fallback in a packed scene', () => {
    const result = packedSceneFromScene(
      { metadata: { timeOfDay: 'User dawn' } },
      styleConfig,
      'zh-CN'
    );
    expect(result.lightingSetup).toBe('符合User dawn的自然光');
    expect(result.look).toBe('用户自写 style, cool shadows');
    expect(result.colorPalette).toBe('#112233');
    expect(packedSceneFromScene({}, styleConfig).lightingSetup).toBe(
      'Natural, even lighting'
    );
  });

  it('passes the chosen language through version resolution and render planning', () => {
    const dialogue = motionPrompt.dialogue ?? { presence: false, lines: [] };
    const resolved = resolveMotionPromptFromVersion(
      { text: motionPrompt.fullPrompt, audio: motionPrompt.audio },
      { promptLocale: 'zh-CN', dialogue, description: null },
      'seedance_v2_5'
    );
    expect(resolved).toContain('保持单个连续镜头，不要切镜。');
    const jobs = buildMotionRender({
      promptLocale: 'zh-CN',
      userId: 'user',
      organizationId: 'org',
      sequenceId: 'sequence',
      shots: [
        {
          shotId: 'shot',
          sceneId: 'scene',
          referenceOnly: true,
          seedanceEditSeconds: null,
          packedScene: {},
          duration: 2,
          model: 'seedance_v2_5',
          prompt: motionPrompt.fullPrompt,
          motionPrompt,
        },
      ],
    });
    expect(jobs[0]?.input.promptLocale).toBe('zh-CN');
    expect(jobs[0]?.input.prompt).toContain('保持单个连续镜头，不要切镜。');
    expect(jobs[0]?.input.prompt).toContain(spokenWords);
  });

  it('shows the same localized assembly in the single-shot and packed request previews', () => {
    for (const packed of [false, true]) {
      const result = buildShotPromptPreview({
        promptLocale: 'zh-CN',
        styleConfig,
        imageModel: 'nano_banana_2',
        videoModel: 'seedance_v2_5',
        imagePrompt: 'user still',
        motionPrompt,
        shotDurationMs: 4000,
        startFrameUrl: 'https://cdn.example/still.png',
        usesStartFrame: true,
        generateAudio: true,
        scene: {
          metadata: { location: 'User Place' },
          continuity: { characterTags: [] },
        },
        characters: [],
        elements: [],
        locations: [],
        byteplusEnabled: false,
        packedMembers: packed
          ? [
              {
                shotId: 'one',
                shotNumber: 1,
                durationMs: 4000,
                motionPrompt,
                usesStartFrame: true,
                startFrameUrl: 'https://cdn.example/still.png',
              },
              {
                shotId: 'two',
                shotNumber: 2,
                durationMs: 4000,
                motionPrompt,
                usesStartFrame: true,
                startFrameUrl: 'https://cdn.example/still.png',
              },
            ]
          : undefined,
      });
      expect(result.assembledMotionPrompt).toContain('不要背景音乐');
      expect(result.assembledMotionPrompt).toContain('自然、均匀的光线');
      expect(result.assembledMotionPrompt).toContain(spokenWords);
      expect(result.motion?.prompt).toContain('不要背景音乐');
      expect(result.motion?.prompt).toContain(spokenWords);
      if (packed) expect(result.motion?.prompt).toContain('Shot 2 (4-8s):');
    }
  });
});
