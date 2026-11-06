import { expect, it } from 'vitest';
import {
  ConflictError,
  OpenStoryError,
  openStoryErrorSerializationAdapter,
} from '@/platform/errors';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizeCastNameConflict } from './localize-cast-name-conflict';

// Synthetic names and error messages exercise the real display adapter only.
const CONFLICTS = [
  {
    message:
      'Grace is already a name in the cast of Story B. Rename one first.',
    chinese: '作品“Story B”中已有名为“Grace”的角色，请先修改其中一个的名称。',
  },
  {
    message: 'Depot is already a location in Story B. Rename one first.',
    chinese: '作品“Story B”中已有名为“Depot”的地点，请先修改其中一个的名称。',
  },
];

it.each(CONFLICTS)(
  'translates only the complete conflict: $message',
  ({ message, chinese }) => {
    const translate = createApplicationI18n().getFixedT(null, 'cast');
    expect(
      localizeCastNameConflict(new ConflictError(message), translate)
    ).toBe(chinese);
  }
);

it.each(CONFLICTS)(
  'preserves the exact English conflict: $message',
  ({ message }) => {
    const translate = createApplicationI18n('en').getFixedT(null, 'cast');
    expect(
      localizeCastNameConflict(new ConflictError(message), translate)
    ).toBe(message);
  }
);

it.each(['zh-CN', 'en'] as const)(
  'preserves user names and interpolation syntax in %s',
  (locale) => {
    const name = '  Grace {{sequenceTitle}} <b>& "雨"  ';
    const title = `Film {{name}}
<0>North</0> &amp;`;
    const translate = createApplicationI18n(locale).getFixedT(null, 'cast');
    for (const kind of ['name in the cast of', 'location in']) {
      const message =
        name + ' is already a ' + kind + ' ' + title + '. Rename one first.';
      const chinese =
        '作品“' +
        title +
        '”中已有名为“' +
        name +
        '”的' +
        (kind === 'location in' ? '地点' : '角色') +
        '，请先修改其中一个的名称。';
      expect(
        localizeCastNameConflict(new ConflictError(message), translate)
      ).toBe(locale === 'en' ? message : chinese);
    }
  }
);

it.each([
  'Rate limit exceeded',
  'Grace is already a name in this sequence. Rename one first.',
  'Depot is already a location in this sequence.',
  'Grace is already a name in the cast of Story B. Rename one first. Please retry.',
  'Grace is already a name in the cast of Story B. Rename one first.\n',
  ' is already a name in the cast of Story B. Rename one first.',
  'Grace is already a name in the cast of . Rename one first.',
  'Depot is already a location in  . Rename one first.',
  'Grace is already a name in the cast of Ada is already a name in the cast of Story. Rename one first.',
  'Depot is already a location in A is already a location in B. Rename one first.',
  'Grace is already a location in A is already a name in the cast of Story. Rename one first.',
  'Grace is already a name in the cast of A is already a location in Story. Rename one first.',
  'Grace is already a location in A is already a name in the cast of B is already a name in the cast of Story. Rename one first.',
  'Grace is already a name in the cast of A is already a location in B is already a location in Story. Rename one first.',
  ' is already a location in A is already a name in the cast of Story. Rename one first.',
  ' is already a name in the cast of A is already a location in Story. Rename one first.',
])(
  'leaves unknown, incomplete or ambiguous conflicts unchanged: %s',
  (message) => {
    const translate = createApplicationI18n().getFixedT(null, 'cast');
    expect(
      localizeCastNameConflict(new ConflictError(message), translate)
    ).toBe(message);
  }
);

it.each(CONFLICTS)(
  'does not interpret provider or unclassified errors: $message',
  ({ message }) => {
    const translate = createApplicationI18n().getFixedT(null, 'cast');
    expect(localizeCastNameConflict(new Error(message), translate)).toBe(
      message
    );
    expect(
      localizeCastNameConflict(
        new OpenStoryError(message, 'PROVIDER_ERROR', 502),
        translate
      )
    ).toBe(message);
  }
);

it.each(CONFLICTS)(
  'accepts serialized conflicts without subclass identity: $message',
  ({ message, chinese }) => {
    const original = new ConflictError(message);
    const restored = openStoryErrorSerializationAdapter.fromSerializable(
      openStoryErrorSerializationAdapter.toSerializable(original)
    );
    const translate = createApplicationI18n().getFixedT(null, 'cast');
    expect(restored).not.toBeInstanceOf(ConflictError);
    expect(localizeCastNameConflict(restored, translate)).toBe(chinese);
  }
);

it('translates a retained error again with the current language without mutating it', async () => {
  const instance = createApplicationI18n();
  const translate = instance.getFixedT(null, 'cast');
  const message = CONFLICTS[0]?.message;
  if (!message) throw new Error('Missing synthetic conflict fixture');
  const error = new ConflictError(message);
  expect(localizeCastNameConflict(error, translate)).toBe(
    CONFLICTS[0]?.chinese
  );
  await instance.changeLanguage('en');
  expect(localizeCastNameConflict(error, translate)).toBe(message);
  expect(error.message).toBe(message);
});
