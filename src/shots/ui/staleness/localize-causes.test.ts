import { describe, expect, it } from 'vitest';
import {
  CHARACTER_LABELS,
  LOCATION_LABELS,
  SCENE_LABELS,
  STYLE_LABELS,
  describeManifestCauses,
} from '@/shots/staleness-causes';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizeCauses } from './localize-causes';
import { describeCauses } from './update-all-dialog';
import type { ShotStaleness } from '../use-shot-staleness';

const translator = (locale: 'en' | 'zh-CN') =>
  createApplicationI18n(locale).getFixedT(null, 'shots');

describe('server causes display adapter', () => {
  it('localizes real manifest causes and their known field lists', () => {
    const source = describeManifestCauses(
      'still',
      [
        'scene/metadata/timeOfDay',
        'styleConfig/lighting',
        'character:cast/standardClothing',
        'character:cast/styling',
        'location:place/architecturalStyle',
        'scriptExtract',
      ],
      {
        characters: new Map([['cast', 'Mia']]),
        locations: new Map([['place', 'Atrium']]),
      }
    );
    expect(localizeCauses(source, translator('zh-CN'))).toEqual([
      '场景：时段',
      '风格：灯光',
      '角色 "Mia"：服装, 造型',
      '地点 "Atrium"：建筑风格',
      '剧本',
    ]);
  });

  it.each([
    'Mia "Boss": Script',
    'Script',
    'clothing',
    '李华：北厅\n第二层',
    'a": clothing, "b',
    '{{name}} <Jack> & Jill',
  ])('preserves every name character in %j', (name) => {
    for (const kind of ['Character', 'Location']) {
      const source = `${kind} "${name}": clothing, sheet`;
      const label = kind === 'Character' ? '角色' : '地点';
      expect(localizeCauses([source], translator('zh-CN'))).toEqual([
        `${label} "${name}"：服装, 设定图`,
      ]);
      expect(localizeCauses([source], translator('en'))).toEqual([source]);
    }
  });

  it('preserves the legacy producer’s named look suffix', () => {
    const identity = '"Jack "West"" (晚装：\n"Look")';
    expect(
      localizeCauses(
        [`Character ${identity}: clothing, look, sheet`],
        translator('zh-CN')
      )
    ).toEqual([`角色 ${identity}：服装, 造型, 设定图`]);
  });

  it('handles bare identities, element tokens and numbered scene causes', () => {
    expect(
      localizeCauses(
        [
          'Character "Script"',
          'Location "Style"',
          'Element LOGO',
          'Scene 2: time of day, cast and tags',
          'Scene 3',
        ],
        translator('zh-CN')
      )
    ).toEqual([
      '角色 "Script"',
      '地点 "Style"',
      '素材 LOGO',
      '场景 2：时段, 角色与标记',
      '场景 3',
    ]);
  });

  it('keeps the whole cause when any field or syntax is unknown', () => {
    const source = [
      'Character "Mia": clothing, future field',
      'Character "Mia": clothing, future: field',
      'Location "Atrium": future field',
      'Scene: time of day, future field',
      'Style: future field',
      'Style: lighting, future: field',
      'Character id: clothing',
      'Character "Mia": clothing,sheet',
      'Unexpected: Script',
      'Provider error: Script',
    ];
    expect(localizeCauses(source, translator('zh-CN'))).toEqual(source);
  });

  it('covers every field exposed by the current producer vocabularies', () => {
    const paths = [
      ...Object.keys(CHARACTER_LABELS).map(
        (field) => `character:cast/${field}`
      ),
      ...Object.keys(LOCATION_LABELS).map((field) => `location:place/${field}`),
      ...Object.keys(SCENE_LABELS).map((field) => `scene/metadata/${field}`),
      ...Object.keys(STYLE_LABELS).map((field) => `styleConfig/${field}`),
    ];
    const chinese = translator('zh-CN');
    for (const path of paths) {
      const source = describeManifestCauses('still', [path], {
        characters: new Map([['cast', 'Mia']]),
        locations: new Map([['place', 'Atrium']]),
      });
      expect(localizeCauses(source, chinese), path).not.toEqual(source);
    }
  });

  it('leaves the English producer output and caller arrays untouched', () => {
    const source = Object.freeze([
      'Script',
      'Image re-rendered',
      'Scene: cast and tags',
      'Style: lighting, palette',
      'Character "Mia": clothing, sheet',
      'Location "Atrium": architecture',
      'Element LOGO',
    ]);
    expect(localizeCauses(source, translator('en'))).toEqual(source);
    expect(source[0]).toBe('Script');
  });

  it('uses the caller locale without sharing a global language', () => {
    const chinese = translator('zh-CN');
    const english = translator('en');
    expect(localizeCauses(['Script'], chinese)).toEqual(['剧本']);
    expect(localizeCauses(['Script'], english)).toEqual(['Script']);
    expect(localizeCauses(['Script'], chinese)).toEqual(['剧本']);
  });

  it('localizes causes through the existing summary consumer', () => {
    const shot: ShotStaleness = {
      thumbnail: 'stale',
      visualPrompt: 'fresh',
      motionPrompt: 'fresh',
      dialogue: 'untracked',
      video: 'untracked',
      causes: ['Script'],
    };
    expect(describeCauses([shot], translator('zh-CN'))).toBe('已更改：剧本');
    expect(describeCauses([shot])).toBe('Changed: Script');
  });
});
