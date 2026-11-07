import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizeSpeakerConflict } from './localize-speaker-conflict';

describe('localized speaker conflicts', () => {
  it('translates duplicate speakers and preserves the authored name', () => {
    const message =
      '2 cast characters are named "ALICE". Rename one so dialogue knows who speaks.';
    expect(
      localizeSpeakerConflict(createApplicationI18n('zh-CN'), message)
    ).toBe(
      '有 2 个角色名为“ALICE”。请修改其中一个名字，以便确定台词的说话人。'
    );
    expect(localizeSpeakerConflict(createApplicationI18n('en'), message)).toBe(
      message
    );
  });

  it('translates candidate separators without translating character names', () => {
    const message =
      '"ANN" could be Ann Lee or Ann Smith. Use the full name so dialogue knows who speaks.';
    expect(
      localizeSpeakerConflict(createApplicationI18n('zh-CN'), message, [
        'Ann Lee',
        'Ann Smith',
      ])
    ).toBe(
      '“ANN”可能指 Ann Lee 或 Ann Smith。请使用全名，以便确定台词的说话人。'
    );
    expect(localizeSpeakerConflict(createApplicationI18n('en'), message)).toBe(
      message
    );
  });

  it('preserves a candidate name containing the joining word', () => {
    const message =
      '"ANN" could be Ann or Anna or Ann Smith. Use the full name so dialogue knows who speaks.';
    expect(
      localizeSpeakerConflict(createApplicationI18n('zh-CN'), message, [
        'Ann or Anna',
        'Ann Smith',
      ])
    ).toBe(
      '“ANN”可能指 Ann or Anna or Ann Smith。请使用全名，以便确定台词的说话人。'
    );
  });

  it('leaves an unrecognized report unchanged', () => {
    const message = 'Notes written by the user';
    expect(
      localizeSpeakerConflict(createApplicationI18n('zh-CN'), message)
    ).toBe(message);
  });
});
