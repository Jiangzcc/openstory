import type { StyleConfig } from '@/platform/server/db/schema/libraries';
import { REFERENCE_LIKENESS_INSTRUCTION } from '@/cast/character-prompt';
import { UNTITLED_SEQUENCE_TITLE } from '@/sequences/untitled-sequence-title';
import type { CharacterBibleEntry } from '@/shots/scene-analysis.schema';
import type { ShotSpec } from '@/shots/shot-list.schema';
import type { Locale } from '@/platform/i18n/locale';
import { localizedPrompt } from '@/platform/i18n/prompt-locale';

const MAX_PROMPT_LENGTH = 2000;
const MAX_SCRIPT_LENGTH = 500;
// The whole drawable spec fits (#2094): framing, action, camera and direction
// are structured, not a slice of the script. Still bounded so one runaway
// field cannot crowd out the drawing instructions.
const MAX_SHOT_TEXT_LENGTH = 1600;
const MAX_CAST_IN_SHOT = 4;
const MAX_PREVIEW_PROMPT_LENGTH = 4000;

/** Scene fields the preview prompt reads. Narrower than SceneSplittingScene. */
export type PreviewShotScene = {
  shots?: ReadonlyArray<
    Pick<
      ShotSpec,
      'shotNumber' | 'framing' | 'action' | 'cameraMovement' | 'direction'
    >
  >;
  originalScript: { extract: string };
  metadata: { title: string; location: string; timeOfDay: string };
};

/** Bible fields a preview draws a character from. */
export type PreviewCharacter = Pick<
  CharacterBibleEntry,
  | 'name'
  | 'age'
  | 'gender'
  | 'physicalDescription'
  | 'standardClothing'
  | 'voiceOnly'
>;

const SKETCH_SUFFIX =
  "The bodies are frozen in that action: if someone sits, they are seated; if someone reaches, the arm is extended. One figure per character. Drawn as a storyboard artist's animatic frame: confident pencil line with flat grey marker tones, three or four values, greyscale only even where the description names a colour. Clear silhouettes, the set blocked in with simple shapes. Camera travel is one or two arrows. A rough pre-production drawing: not a finished illustration, not a photo, not a 3D render. The drawing fills the whole image edge to edge: no border, no frame line, no paper margin, no grid of panels.";

const NO_TEXT_SUFFIX =
  'No text, no titles, no subtitles, no watermarks, no letters, no words, no signs, no UI elements.';

const SKETCH_SUFFIX_ZH =
  '人物身体定格在所述动作中：若正在坐下，就画已坐着的状态；若正在伸手，就画手臂已伸出的状态。每个角色只出现一次。绘制为分镜师的动态分镜画面：明确的铅笔线条搭配平涂灰色马克笔色块，仅用三至四个明度层次；即使描述指定了颜色，也只使用灰度。轮廓清晰，以简洁形体交代场景。摄影机移动只用一至两个箭头表示。保持前期制作草图的粗略质感，不是完成的插画、照片或三维渲染。画面铺满整张图，不留边框、框线、纸张边距，也不画多格分镜。';
const NO_TEXT_SUFFIX_ZH =
  '不要文字、标题、字幕、水印、字母、词语、标牌或界面元素。';

function formatStyleDetails(styleConfig: StyleConfig, locale: Locale): string {
  const details = [
    `${localizedPrompt(locale, 'Art style', '美术风格')}: ${styleConfig.look.artStyle}`,
    `${localizedPrompt(locale, 'Mood', '氛围')}: ${styleConfig.look.mood}`,
    `${localizedPrompt(locale, 'Lighting', '布光')}: ${styleConfig.look.lighting}`,
  ];

  return details.join('. ') + '.';
}

function clampPrompt(prompt: string, max = MAX_PROMPT_LENGTH): string {
  if (prompt.length <= max) return prompt;
  return prompt.slice(0, max - 3) + '...';
}

/**
 * Build an image generation prompt for a sequence poster image.
 * Combines the sequence title, opening script text, and style config
 * into a single prompt suitable for fast preview image generation.
 */
export function buildPosterPrompt(
  title: string,
  script: string,
  styleConfig?: StyleConfig,
  locale: Locale = 'en'
): string {
  const scriptExcerpt = script.slice(0, MAX_SCRIPT_LENGTH).trim();

  // The poster renders before scene-split names the sequence, so the title
  // is normally still the placeholder — say nothing rather than "Untitled".
  const parts: string[] = [
    title === UNTITLED_SEQUENCE_TITLE
      ? localizedPrompt(
          locale,
          'A cinematic establishing shot.',
          '电影感的场景建立镜头。'
        )
      : localizedPrompt(
          locale,
          `A cinematic establishing shot for "${title}".`,
          `为《${title}》绘制电影感的场景建立镜头。`
        ),
    `${localizedPrompt(locale, 'Opening scene', '开场场景')}: ${scriptExcerpt}`,
  ];

  if (styleConfig) {
    const style = formatStyleDetails(styleConfig, locale);
    if (style) parts.push(style);
  }

  parts.push(localizedPrompt(locale, NO_TEXT_SUFFIX, NO_TEXT_SUFFIX_ZH));
  return clampPrompt(parts.join(' '));
}

/**
 * Animatic text for one shot's preview (#1642). Shot spec is the source of
 * truth, including on a 1-shot scene; the scene slice is the empty-spec
 * fallback. The action is the picture (#2379): framing and the start state
 * only place people and the set. Sound, dialogue and direction stay out.
 * Direction is a performance note, and lettering it made the model draw the
 * moment before the action. Style stays out (#1277). Location/time-of-day
 * live on the scene and already show up inside composition — appending them
 * draws signage.
 */
export function previewTextForShot(
  scene: PreviewShotScene,
  shotNumber: number,
  locale: Locale = 'en'
): string {
  const spec = scene.shots?.find((shot) => shot.shotNumber === shotNumber);
  if (spec) {
    const clean = (part: string) => part.trim().replace(/\.+$/, '');
    const framing = [
      spec.framing.shotSize,
      spec.framing.angle,
      spec.framing.composition,
    ]
      .map(clean)
      .filter((part) => part.length > 0)
      .join(', ');
    const camera = [spec.cameraMovement.move, spec.cameraMovement.pacing]
      .map(clean)
      .filter((part) => part.length > 0)
      .join(', ');
    const action = clean(spec.action);
    const start = clean(spec.framing.subjectStartState);
    const parts = [
      action &&
        `${localizedPrompt(locale, 'Frozen in this action', '定格在此动作中')}: ${action}`,
      framing && `${localizedPrompt(locale, 'Framing', '取景')}: ${framing}`,
      start &&
        `${localizedPrompt(locale, 'Placement only, not the pose', '仅用于位置安排，不作为姿态')}: ${start}`,
      camera &&
        `${localizedPrompt(locale, 'Camera, as one or two arrows', '摄影机移动，用一至两个箭头表示')}: ${camera}`,
    ].filter((part) => part.length > 0);
    if (parts.length > 0) return parts.join('. ');
  }
  return (
    scene.originalScript.extract ||
    scene.metadata.title ||
    localizedPrompt(locale, 'A cinematic scene', '电影感的场景')
  );
}

const LOOK_WORDS = 8;
const TRAILING_LOOK_WORD =
  /^(with|of|and|or|a|an|the|in|on|her|his|to|for|from)$/i;

/** A few words of a look. A bible sentence is what the sketch was lettering. */
function sketchLook(part: string): string {
  const words = part
    .trim()
    .replace(/[.]+$/, '')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, LOOK_WORDS);
  while (words.length > 1) {
    const last = words[words.length - 1]?.replace(/[,:;]+$/, '') ?? '';
    if (!TRAILING_LOOK_WORD.test(last)) break;
    words.pop();
  }
  return words.join(' ').replace(/[,:;]+$/, '');
}

/**
 * The characters a shot's text names, as a short look (#2094, #2369). The
 * bibles call has finished before the first shot list lands, so a preview can
 * draw the cast as written without waiting for a sheet. No "Name:" caption.
 */
function previewCastForShot(
  shotText: string,
  cast: ReadonlyArray<PreviewCharacter>
): string {
  const text = shotText.toLowerCase();
  return (
    cast
      // ponytail: a name match, so a shot that only says "she" draws a
      // generic figure. Resolve through the scene roster if that shows.
      .filter(
        (entry) =>
          !entry.voiceOnly &&
          entry.name.trim().length > 0 &&
          text.includes(entry.name.trim().toLowerCase())
      )
      .slice(0, MAX_CAST_IN_SHOT)
      .map((entry) =>
        [
          entry.name.trim(),
          entry.gender.trim(),
          entry.age.trim(),
          sketchLook(
            entry.physicalDescription.replace(
              REFERENCE_LIKENESS_INSTRUCTION,
              ''
            )
          ),
          sketchLook(entry.standardClothing),
        ]
          .filter((part) => part.length > 0)
          .join(', ')
      )
      .filter((line) => line.length > 0)
      .map((line) => `${line}.`)
      .join(' ')
  );
}

/**
 * Build an image generation prompt for a fast shot preview.
 *
 * Previews are stand-ins rendered before any character/location reference
 * exists, so anything rendered "for real" is wrong by construction and reads
 * as inconsistency (or worse, as the final look) — #1277. Ask for a grey
 * storyboard animatic panel instead (#2094): staged and posed like the shot,
 * drawn so nobody takes it for the still.
 * Deliberately ignores the style config for the same reason — a photoreal
 * style would pull the sketch back toward realism.
 */
export function buildPreviewPrompt(
  shotText: string,
  cast: ReadonlyArray<PreviewCharacter>,
  locale: Locale = 'en'
): string {
  const excerpt = shotText
    .slice(0, MAX_SHOT_TEXT_LENGTH)
    .trim()
    .replace(/\.+$/, '');
  const characters = previewCastForShot(excerpt, cast);

  return clampPrompt(
    [
      localizedPrompt(
        locale,
        `One greyscale storyboard frame. ${excerpt}.`,
        `单张灰度分镜画面。${excerpt}。`
      ),
      characters &&
        `${localizedPrompt(locale, 'Characters', '角色')}: ${characters}`,
      localizedPrompt(locale, SKETCH_SUFFIX, SKETCH_SUFFIX_ZH),
      localizedPrompt(locale, NO_TEXT_SUFFIX, NO_TEXT_SUFFIX_ZH),
    ]
      .filter((part) => part)
      .join(' '),
    MAX_PREVIEW_PROMPT_LENGTH
  );
}
