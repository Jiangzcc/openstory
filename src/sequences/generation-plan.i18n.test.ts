import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  blockedLines,
  planWorkLabel,
  planWorkLine,
  planWorkSummary,
  type PlanUnit,
  type PlanUnitKind,
  type PlanUnitRef,
} from './generation-plan';

function unit(
  kind: PlanUnitKind,
  id: string,
  state: PlanUnit['state'] = 'missing',
  blockedBy: PlanUnitRef[] = []
): PlanUnit {
  return { kind, id, state, blockedBy, requires: [], cascaded: false };
}

const chinese = createApplicationI18n().getFixedT(null, 'sequences');
const english = createApplicationI18n('en').getFixedT(null, 'sequences');

const quantities = [
  ['sheet:character', 'reference', 'references', '份参考素材'],
  ['sheet:location', 'reference', 'references', '份参考素材'],
  ['ref:element', 'reference', 'references', '份参考素材'],
  ['voice', 'voice', 'voices', '个角色语音'],
  ['spec', 'shot rewrite', 'shot rewrites', '次镜头改写'],
  ['prompt:visual', 'prompt', 'prompts', '份提示词'],
  ['prompt:motion', 'prompt', 'prompts', '份提示词'],
  ['prompt:music', 'prompt', 'prompts', '份提示词'],
  ['still', 'image', 'images', '张图像'],
  ['dialogue', 'recording', 'recordings', '段录音'],
  ['clip', 'video', 'videos', '段视频'],
  ['music', 'music track', 'music tracks', '首配乐'],
] as const;

describe('plan quantities', () => {
  it.each(quantities)(
    'localizes %s counts without changing English',
    (kind, one, many, noun) => {
      const single = [unit(kind, 'one')];
      const pair = [...single, unit(kind, 'two')];
      expect(planWorkSummary(single)).toBe('1 ' + one);
      expect(planWorkSummary(pair)).toBe('2 ' + many);
      expect(planWorkSummary(single, english)).toBe(planWorkSummary(single));
      expect(planWorkSummary(pair, english)).toBe(planWorkSummary(pair));
      expect(planWorkSummary(single, chinese)).toBe('1 ' + noun);
      expect(planWorkSummary(pair, chinese)).toBe('2 ' + noun);
    }
  );
});

describe('plan noun grouping', () => {
  it('keeps grouping and order when kinds share a noun', () => {
    const work = [
      unit('sheet:character', 'c'),
      unit('still', 's'),
      unit('sheet:location', 'l'),
      unit('ref:element', 'e'),
    ];
    expect(planWorkSummary(work)).toBe('3 references, 1 image');
    expect(planWorkSummary(work, english)).toBe(planWorkSummary(work));
    expect(planWorkSummary(work, chinese)).toBe('3 份参考素材、1 张图像');
    expect(planWorkSummary([], chinese)).toBe('');
  });
});

describe('plan work labels', () => {
  it('keeps fresh and stale work apart and translates each button state', () => {
    const stale = [unit('still', 'a', 'stale'), unit('still', 'b', 'stale')];
    const fresh = [unit('clip', 'c')];
    expect(planWorkLine([...stale, ...fresh], english)).toBe(
      '1 video · redo 2 images'
    );
    expect(planWorkLine([...stale, ...fresh], chinese)).toBe(
      '1 段视频 · 重新生成2 张图像'
    );
    expect(planWorkLine(stale, chinese)).toBe('2 张图像');
    expect(planWorkLine(fresh, chinese)).toBe('1 段视频');
    expect(planWorkLine([], chinese)).toBe('');
    expect(planWorkLabel(stale, chinese)).toBe('重新生成');
    expect(planWorkLabel(fresh, chinese)).toBe('生成');
    expect(planWorkLabel([], chinese)).toBe('没有需要生成的内容');
    for (const work of [stale, fresh, [], [...stale, ...fresh]]) {
      expect(planWorkLine(work, english)).toBe(planWorkLine(work));
      expect(planWorkLabel(work, english)).toBe(planWorkLabel(work));
    }
  });
});

describe('plan blocked dependencies', () => {
  it('preserves names verbatim, deduplicates blockers and respects stopAt', () => {
    const name = 'Maya {{value2}} <0> &lt;';
    const refs: PlanUnitRef[] = [
      { kind: 'sheet:character', id: 'maya' },
      { kind: 'prompt:visual', id: 'prompt' },
    ];
    const plan = [
      unit('still', 'a', 'blocked', refs),
      unit('still', 'b', 'blocked', refs),
      unit('clip', 'c', 'blocked'),
    ];
    const nameOf = (ref: PlanUnitRef) => (ref.id === 'maya' ? name : undefined);
    expect(blockedLines(plan, 'images', nameOf, english)).toEqual(
      blockedLines(plan, 'images', nameOf)
    );
    expect(blockedLines(plan, 'images', nameOf, chinese)).toEqual([
      '2 张图像受阻：等待' + name + '的参考素材、1 份提示词',
    ]);
    expect(blockedLines(plan, 'motion', nameOf, chinese)).toEqual([
      '2 张图像受阻：等待' + name + '的参考素材、1 份提示词',
      '1 段视频受阻：无法检查',
    ]);
    expect(blockedLines(plan, 'references', nameOf, chinese)).toEqual([]);
    expect(blockedLines([], 'music', nameOf, chinese)).toEqual([]);
  });
});

describe('plan locale switching', () => {
  it('uses the active locale with the same plan and translation callback', async () => {
    const i18n = createApplicationI18n();
    const translate = i18n.getFixedT(null, 'sequences');
    const work = [unit('clip', 'shot')];
    expect(planWorkLine(work, translate)).toBe('1 段视频');
    await i18n.changeLanguage('en');
    expect(planWorkLine(work, translate)).toBe('1 video');
  });
});
