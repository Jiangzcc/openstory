import { describe, expect, it } from 'vitest';
import {
  missingVoiceLines,
  unusableReferenceLines,
  unusableShotReferenceLines,
} from '@/motion/reference-support';
import type { ImageToVideoModel } from '@/models/models';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizeReferenceProblem } from './localize-reference-problem';

const cases: {
  model: ImageToVideoModel;
  kind: 'video' | 'audio';
  seconds: number;
  url?: string;
  expected: string;
}[] = [
  {
    model: 'kling_v3_pro',
    kind: 'video',
    seconds: 10,
    expected: '不支持参考视频',
  },
  {
    model: 'kling_v3_pro',
    kind: 'audio',
    seconds: 10,
    expected: '不支持参考音频',
  },
  {
    model: 'minimax_h3_max',
    kind: 'video',
    seconds: 15.05,
    expected: '15.05 秒',
  },
  { model: 'minimax_h3_max', kind: 'video', seconds: 0.5, expected: '最短' },
  { model: 'minimax_h3_max', kind: 'audio', seconds: 0.5, expected: '最短' },
  {
    model: 'seedance_v2_5',
    kind: 'audio',
    seconds: 3.75,
    url: '/r2/memo.m4a',
    expected: 'M4A',
  },
];

describe('reference problem display localization', () => {
  it.each(cases)(
    'localizes a real $kind refusal for $model at $seconds seconds',
    ({ model, kind, seconds, url, expected }) => {
      const [source = ''] = unusableReferenceLines(model, [
        {
          token: 'Draft {{model}} & 原稿',
          kind,
          durationSeconds: seconds,
          imageUrl: url,
        },
      ]);
      expect(source).not.toBe('');
      const chinese = localizeReferenceProblem(
        createApplicationI18n('zh-CN'),
        source
      );
      expect(chinese).not.toBe(source);
      expect(chinese).toContain(expected);
      expect(chinese).toContain('Draft {{model}} & 原稿');
      expect(
        localizeReferenceProblem(createApplicationI18n('en'), source)
      ).toBe(source);
    }
  );

  it('keeps all reference tokens when the combined duration is too long', () => {
    const [source = ''] = unusableShotReferenceLines(
      'minimax_h3_max',
      [
        { token: 'DOLLY and CRANE', kind: 'video', durationSeconds: 9 },
        { token: 'Alice {{value1}}', kind: 'video', durationSeconds: 9 },
      ],
      { hasStartFrame: true, prompt: null, onArk: false }
    );
    const chinese = localizeReferenceProblem(createApplicationI18n(), source);
    expect(chinese).toContain('总时长 18 秒');
    expect(chinese).toContain('DOLLY and CRANE and Alice {{value1}}');
    expect(localizeReferenceProblem(createApplicationI18n('en'), source)).toBe(
      source
    );
  });

  it('localizes audio-only and Seedance edit requirements without changing refusals', () => {
    const job = { hasStartFrame: false, prompt: null, onArk: true };
    const [audio = ''] = unusableShotReferenceLines(
      'seedance_v2_5',
      [{ token: 'VOICE', kind: 'audio', durationSeconds: 3 }],
      job
    );
    const [edit = ''] = unusableShotReferenceLines(
      'seedance_v2_5',
      [{ token: 'CLIP', kind: 'video', durationSeconds: 2 }],
      { ...job, hasStartFrame: true, prompt: 'Edit the run' }
    );
    const i18n = createApplicationI18n();
    expect(localizeReferenceProblem(i18n, audio)).toContain('不能单独');
    expect(localizeReferenceProblem(i18n, edit)).toBe(
      'Seedance 仅支持编辑 4 至 30 秒的视频；当前视频为 2 秒。'
    );
    expect(localizeReferenceProblem(createApplicationI18n('en'), edit)).toBe(
      edit
    );
  });

  it('preserves the character and voice names in a deleted-voice message', async () => {
    const [source = ''] = missingVoiceLines(
      'seedance_v2_5',
      {
        lines: [
          { character: "Alice's draft {{voice}}", voiceToken: 'GONE_VOICE' },
        ],
      },
      []
    );
    const i18n = createApplicationI18n();
    expect(localizeReferenceProblem(i18n, source)).toBe(
      "Alice's draft {{voice}} 的台词所用音色 GONE_VOICE 已删除，请重新选择音色。"
    );
    await i18n.changeLanguage('en');
    expect(localizeReferenceProblem(i18n, source)).toBe(source);
  });

  it.each([
    'Provider returned an unknown reference error.',
    "First can't use Other can't use CLIP — it takes no reference clips.",
    "Seedance 2.5 can't use CLIP — it is M4A, and models take MP3 or WAV. Replace it with an MP4 or MOV file.",
  ])('preserves unknown or ambiguous provider text: %s', (source) => {
    expect(localizeReferenceProblem(createApplicationI18n(), source)).toBe(
      source
    );
  });
});
