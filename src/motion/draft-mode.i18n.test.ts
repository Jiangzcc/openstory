import { describe, expect, it, vi } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  draftBadgeLabel,
  draftExpirySuffix,
  draftTaskUsable,
  shotDraftLabel,
  theatreDraftLabel,
} from './draft-mode';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 4);
const chinese = createApplicationI18n().getFixedT(null, 'motion');
const english = createApplicationI18n('en').getFixedT(null, 'motion');
const final = { primaryVideo: { draftTaskId: null, createdAt: NOW } };

function draft(ageDays: number) {
  return {
    primaryVideo: {
      draftTaskId: 'draft-task',
      createdAt: NOW - ageDays * DAY_MS,
    },
  };
}

describe('draft expiry localization', () => {
  it.each([
    [0, null, 'Draft', '预览版'],
    [3, null, 'Draft', '预览版'],
    [4, ' · 3 days left', 'Draft · 3 days left', '预览版 · 剩余 3 天'],
    [5, ' · 2 days left', 'Draft · 2 days left', '预览版 · 剩余 2 天'],
    [5.5, ' · 1 day left', 'Draft · 1 day left', '预览版 · 剩余 1 天'],
    [6.5, ' · expires today', 'Draft · expires today', '预览版 · 今日到期'],
    [7, ' expired', 'Draft expired', '预览版 已过期'],
  ] as const)(
    'keeps the expiry and separators at age %s days',
    (age, suffix, label, translated) => {
      const createdAt = NOW - age * DAY_MS;
      expect(draftExpirySuffix(createdAt, NOW)).toBe(suffix);
      expect(draftExpirySuffix(createdAt, NOW, english)).toBe(suffix);
      expect(draftBadgeLabel(createdAt, NOW)).toBe(label);
      expect(draftBadgeLabel(createdAt, NOW, english)).toBe(label);
      expect(draftBadgeLabel(createdAt, NOW, chinese)).toBe(translated);
      expect(shotDraftLabel(draft(age), NOW, chinese)).toBe(translated);
      expect(draftTaskUsable(createdAt, NOW)).toBe(age < 7);
    }
  );
});

describe('absent draft labels', () => {
  it('preserves null results for absent or final clips', () => {
    for (const shot of [null, undefined, { primaryVideo: null }, final])
      expect(shotDraftLabel(shot, NOW, chinese)).toBeNull();
    expect(theatreDraftLabel([], NOW, chinese)).toBeNull();
    expect(
      theatreDraftLabel([final, { primaryVideo: null }], NOW, chinese)
    ).toBeNull();
    expect(draftExpirySuffix(NOW, NOW, chinese)).toBeNull();
  });
});

describe('draft cut labels', () => {
  it('translates cuts and mixed shots while keeping the earliest expiry', () => {
    const shots = [draft(1), final, draft(5)];
    expect(theatreDraftLabel(shots, NOW, english)).toBe(
      theatreDraftLabel(shots, NOW)
    );
    expect(theatreDraftLabel(shots, NOW, chinese)).toBe(
      '3 个镜头中有 2 个为预览版 · 剩余 2 天'
    );
    expect(theatreDraftLabel([draft(1), draft(5)], NOW, chinese)).toBe(
      '预览版剪辑 · 剩余 2 天'
    );
    expect(theatreDraftLabel([draft(0), draft(1)], NOW, chinese)).toBe(
      '预览版剪辑'
    );
    expect(theatreDraftLabel([draft(7)], NOW, chinese)).toBe(
      '预览版剪辑 已过期'
    );
  });
});

describe('draft clock compatibility', () => {
  it('retains the default clock and supported date representations', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const createdAt = NOW - 5 * DAY_MS;
    try {
      for (const value of [
        createdAt,
        new Date(createdAt),
        new Date(createdAt).toISOString(),
      ])
        expect(draftBadgeLabel(value, undefined, chinese)).toBe(
          '预览版 · 剩余 2 天'
        );
    } finally {
      clock.mockRestore();
    }
  });
});

describe('draft locale switching', () => {
  it('changes only the label when the active locale changes', async () => {
    const i18n = createApplicationI18n();
    const translate = i18n.getFixedT(null, 'motion');
    const shot = draft(5);
    expect(shotDraftLabel(shot, NOW, translate)).toBe('预览版 · 剩余 2 天');
    await i18n.changeLanguage('en');
    expect(shotDraftLabel(shot, NOW, translate)).toBe('Draft · 2 days left');
    expect(shot.primaryVideo.draftTaskId).toBe('draft-task');
    expect(draftTaskUsable(shot.primaryVideo.createdAt, NOW)).toBe(true);
  });
});
