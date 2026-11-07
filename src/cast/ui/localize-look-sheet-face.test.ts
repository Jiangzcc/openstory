import { describe, expect, it } from 'vitest';
import {
  defaultLookCaption,
  lookSheetFaceMessage,
} from '@/cast/look-sheet-face';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  localizeDefaultLookCaption,
  localizeLookSheetFaceMessage,
} from './localize-look-sheet-face';

const states = ['ready', 'generating', 'missing'] as const;
const names = ['Default', ' Default ', 'Clean white shirt', 'Default look'];

describe('localized look sheet captions', () => {
  it.each(names)('keeps the English caption contract for %s', (name) => {
    const t = createApplicationI18n('en').getFixedT('en', 'cast');
    for (const hasOtherLooks of [false, true]) {
      expect(localizeDefaultLookCaption(t, name, hasOtherLooks)).toBe(
        defaultLookCaption(name, hasOtherLooks)
      );
    }
    for (const state of states) {
      expect(localizeLookSheetFaceMessage(t, name, state)).toBe(
        lookSheetFaceMessage(name, state)
      );
    }
  });

  it('translates the first default look explanation', () => {
    const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    const caption = localizeDefaultLookCaption(t, 'Clean white shirt', false);
    expect(caption).toMatch(/\p{Script=Han}/u);
    expect(caption).not.toContain('This is the default look.');
    expect(caption).not.toContain('Clean white shirt');
  });

  it.each(['Default', ' Default '])(
    'translates the synthesized %s label without repeating its name',
    (name) => {
      const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
      const captions = [
        localizeDefaultLookCaption(t, name, true),
        ...states.map((state) => localizeLookSheetFaceMessage(t, name, state)),
      ];
      for (const caption of captions) {
        expect(caption).toMatch(/\p{Script=Han}/u);
        expect(caption).not.toContain('Default');
        expect(caption).not.toContain('Drawn from');
      }
    }
  );

  it('preserves a user look name without treating its words as UI copy', () => {
    const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    const name =
      'Default look. That sheet is still generating. <coat> & "帽子"';
    const captions = [
      localizeDefaultLookCaption(t, name, true),
      ...states.map((state) => localizeLookSheetFaceMessage(t, name, state)),
    ];
    for (const caption of captions) {
      expect(caption).toContain(name);
      expect(caption.replace(name, '')).toMatch(/\p{Script=Han}/u);
      expect(caption.replace(name, '')).not.toContain('The face stays');
    }
  });

  it('distinguishes ready, generating and missing states in Chinese', () => {
    const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    const captions = states.map((state) =>
      localizeLookSheetFaceMessage(t, 'Clean white shirt', state)
    );
    expect(new Set(captions).size).toBe(states.length);
    for (const caption of captions) {
      expect(caption).toContain('Clean white shirt');
      expect(caption.replace('Clean white shirt', '')).toMatch(
        /\p{Script=Han}/u
      );
    }
  });
});
