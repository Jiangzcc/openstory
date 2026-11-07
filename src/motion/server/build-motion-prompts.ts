import { sceneDirection } from '@/shots/scene-direction';
import type { StyleConfig } from '@/look/style-config';
import type { Locale } from '@/platform/i18n/locale';
import { motionPromptText } from './motion-prompt-language';
/** Enrich authored motion prose with model-specific dialogue and audio directions. */

import type {
  AssemblableMotionPrompt,
  DialogueLine,
  MotionAudio,
  MotionDialogue,
} from '@/shots/scene-analysis.schema';
import {
  IMAGE_TO_VIDEO_MODELS,
  type ImageToVideoModel,
  videoModelSupportsAudio,
} from '@/models/models';
import {
  DIALOGUE_CLIP_TOKEN,
  isElementVoiceToken,
} from '@/motion/dialogue-tts';

/** Keep the sequence's removable music track separate from dialogue and diegetic sound. */
const NO_MUSIC_DIRECTION =
  'No BGM, no music. Generate only dialogue, environmental sounds, and action sounds.';

/** Same direction for a shot with no lines: a dialogue whitelist invites invented speech. */
const NO_MUSIC_NO_DIALOGUE_DIRECTION =
  'No BGM, no music, no dialogue. Generate only environmental sounds and action sounds.';

function noMusicDirection(hasDialogue: boolean, locale: Locale): string {
  return motionPromptText(
    hasDialogue ? NO_MUSIC_DIRECTION : NO_MUSIC_NO_DIALOGUE_DIRECTION,
    locale
  );
}

/** Audio "off" for a model that always renders sound (Kling 4). */
const SILENT_SOUNDSCAPE = 'Silent. No dialogue, no sound effects, no music.';

/**
 * Scene-level look stated once at the top of a packed prompt. Per-shot bodies
 * then only describe action, camera, dialogue, and SFX.
 */
export type PackedMotionSceneHeader = {
  location?: string | null;
  timeOfDay?: string | null;
  lightingSetup?: string | null;
  colorPalette?: string | null;
  look?: string | null;
};

type AssembleOptions = {
  promptLocale?: Locale;
  motionPrompt: AssemblableMotionPrompt;
  model: ImageToVideoModel;
  /**
   * Scene character tags (`continuity.characterTags`). Drives character-only
   * guards for models that need them in-prompt (e.g. Seedance's
   * "Avoid jitter and bent limbs.").
   */
  characterTags?: readonly string[];
  /**
   * The scene editor's "Include SFX & dialogue" toggle. Models with a
   * `generate_audio` request field get it there; H3 Max has no field and
   * always renders an audio track, so `false` is written into its prompt.
   */
  generateAudio?: boolean;
  /**
   * Pin a one-take clip. Seedance otherwise invents cuts; Omni Flash
   * otherwise defaults to multi-shot. Packed in-clip renders pass `false`
   * (#1510). Default true so existing 1-shot callers stay byte-identical.
   */
  singleTake?: boolean;
  /**
   * Packed members omit clip-wide constraints (no-music, jitter). The pack
   * header states those once so they are not repeated per shot.
   */
  omitSharedConstraints?: boolean;
  /**
   * Prepend the packed scene environment (location, lighting, palette, look).
   * Used on a 1-shot job of a 2+ shot scene so a peeled/Grok clip still gets
   * the look that packed clips put in the header. Default false so 1-shot
   * LLM scenes stay byte-identical.
   */
  attachSceneHeader?: boolean;
  /** Scene look for {@link AssembleOptions.attachSceneHeader}. */
  scene?: PackedMotionSceneHeader;
};

/**
 * Assemble a model-specific motion prompt from structured data.
 *
 * The LLM's `fullPrompt` provides the rich narrative base. Every model that
 * outputs audio gets the dialogue lines and the audio direction in the
 * format it handles. A model with no `generate_audio` field is silenced in
 * that prompt.
 */
export function buildMotionShotPrompt({
  promptLocale = 'en',
  motionPrompt,
  model,
  characterTags,
  generateAudio,
  singleTake = true,
  omitSharedConstraints = false,
  attachSceneHeader = false,
  scene,
}: AssembleOptions): string {
  const { dialogue, audio, fullPrompt } = motionPrompt;
  const supportsAudio = videoModelSupportsAudio(model);
  const vendor = IMAGE_TO_VIDEO_MODELS[model].vendor;

  let assembled: string;

  if (!supportsAudio) {
    assembled = fullPrompt;
  } else {
    // Audio-capable models: enrich fullPrompt with dialogue + audio sections.
    // Stored rows and UI overrides may still be null; the LLM schema uses
    // emptyable objects. Normalize null → undefined for the builders.
    const hasDialogue = dialogue?.presence && dialogue.lines.length > 0;
    const dialogueData = hasDialogue ? dialogue : undefined;
    const audioData = audio ?? undefined;

    switch (vendor) {
      case 'Kling':
        // Kling 4 has no generate_audio switch: "off" is asked for in-prompt,
        // like MiniMax H3. Packed clips put it in the header instead.
        if (model === 'kling_v4' && generateAudio === false) {
          assembled = omitSharedConstraints
            ? fullPrompt
            : `${fullPrompt}\n\n${motionPromptText(SILENT_SOUNDSCAPE, promptLocale)}`;
          break;
        }
        assembled = buildKlingPrompt(
          fullPrompt,
          dialogueData,
          audioData,
          omitSharedConstraints,
          promptLocale
        );
        break;
      case 'ByteDance':
        assembled = buildSeedancePrompt(
          fullPrompt,
          dialogueData,
          audioData,
          characterTags,
          singleTake,
          omitSharedConstraints,
          promptLocale
        );
        break;
      case 'MiniMax':
        assembled = buildMinimaxH3Prompt(
          fullPrompt,
          dialogueData,
          audioData,
          generateAudio,
          omitSharedConstraints,
          promptLocale
        );
        break;
      case 'Google':
      case 'SpaceXAI':
        // No generate_audio field. Off is the prompt, as with Kling 4.
        if (generateAudio === false) {
          assembled = omitSharedConstraints
            ? fullPrompt
            : `${fullPrompt}\n\n${motionPromptText(SILENT_SOUNDSCAPE, promptLocale)}`;
        } else {
          assembled = buildVeoPrompt(
            fullPrompt,
            dialogueData,
            audioData,
            omitSharedConstraints,
            promptLocale
          );
        }
        // Omni Flash defaults to multi-shot; pin a oner only on a 1-shot segment.
        if (singleTake && model === 'gemini_omni_flash') {
          assembled = `${assembled}\n\n${motionPromptText('Single unbroken scene.', promptLocale)}`;
        }
        break;
      default:
        assembled = buildVeoPrompt(
          fullPrompt,
          dialogueData,
          audioData,
          omitSharedConstraints,
          promptLocale
        );
        break;
    }
  }

  if (attachSceneHeader) {
    return joinPacked(formatPackedEnvironment(scene), assembled);
  }
  return assembled;
}

/** One shot inside a packed in-clip generation (#1510). */
export type PackedMotionPromptShot = {
  durationSeconds: number;
  motionPrompt?: AssemblableMotionPrompt;
  /** Fallback when no structured prompt was snapshotted (manual paths). */
  prompt?: string;
  characterTags?: readonly string[];
  generateAudio?: boolean;
  /**
   * 1-shot jobs of a 2+ shot scene prepend the packed environment. Ignored
   * on 2+ packed lists — those always use the scene header.
   */
  attachSceneHeader?: boolean;
};

/** Bytes reserved for the start-frame line and reference legend after packing. */
const PACKED_PROMPT_RESERVE = 256;

export function packedSceneFromScene(
  scene:
    | {
        metadata?: { location?: string; timeOfDay?: string } | null;
        continuity?: {
          lightingSetup?: string;
          colorPalette?: string;
          styleTag?: string;
        } | null;
      }
    | null
    | undefined,
  styleConfig: StyleConfig,
  promptLocale: Locale = 'en'
): PackedMotionSceneHeader {
  return sceneDirection(scene ?? {}, styleConfig, promptLocale);
}

/**
 * True when this packed payload fits the ceiling the via enforces.
 *
 * `hardLimit` is `videoPromptHardLimit(model)`: undefined where the provider
 * documents no cap (every Seedance endpoint), and then nothing is too long to
 * pack (#1754). Refusing to pack against a number we invented was blocking
 * clips the model would have rendered.
 */
export function packedPromptFitsLimit(
  packed: PackedMotionPrompt,
  hardLimit: number | undefined
): boolean {
  if (hardLimit === undefined) return true;
  const budget = Math.max(1, hardLimit - PACKED_PROMPT_RESERVE);
  if (packed.multiPrompt && packed.multiPrompt.length > 0) {
    const elementBudget = Math.min(budget, packed.maxElementLength ?? budget);
    return packed.multiPrompt.every(
      (element) => element.prompt.length <= elementBudget
    );
  }
  return packed.prompt.length <= budget;
}

type KlingMultiPromptElement = {
  prompt: string;
  /** v3: the string enum `'1'`…`'15'`. v4: an integer 1–30. */
  duration: string | number;
};

export type PackedMotionPrompt = {
  prompt: string;
  /** Kling only: structured `multi_prompt[]`. Absent on other vendors. */
  multiPrompt?: KlingMultiPromptElement[];
  /** Per-element cap fal enforces below the whole-prompt one (Kling 4: 512). */
  maxElementLength?: number;
};

/**
 * Assemble one generation covering several shots of a scene. Per-shot bodies
 * come from {@link buildMotionShotPrompt}; this only adds vendor shot-list
 * syntax and timings. A 1-shot list is the existing single-take path.
 *
 * A 2+ shot clip is a scene header (environment, no-music, jitter) once,
 * then short per-shot bodies. Truncating the joined prompt would drop a
 * whole trailing shot — callers split membership instead.
 */
export function buildPackedMotionPrompt({
  promptLocale = 'en',
  shots,
  model,
  generateAudio,
  scene,
}: {
  promptLocale?: Locale;
  shots: readonly PackedMotionPromptShot[];
  model: ImageToVideoModel;
  generateAudio?: boolean;
  scene?: PackedMotionSceneHeader;
}): PackedMotionPrompt {
  const first = shots[0];
  if (!first) return { prompt: '' };
  if (shots.length === 1) {
    const body = assembleOnePackedShot(
      first,
      model,
      generateAudio,
      true,
      false,
      promptLocale
    );
    const header = first.attachSceneHeader
      ? formatPackedEnvironment(scene)
      : '';
    return { prompt: joinPacked(header, body) };
  }

  const characterTags = uniqueCharacterTags(shots);
  const bodies = shots.map((shot) =>
    assembleOnePackedShot(shot, model, generateAudio, false, true, promptLocale)
  );
  const list = formatPackedShotList(model, shots, bodies);
  if (model === 'seedance_v2_5') {
    // BytePlus 2.5: timestamps or Shot N, each shot its own paragraph.
    // 2.0 only follows shot numbers and uses `cut to`; 2.5 does not.
    // https://docs.byteplus.com/en/docs/ModelArk/2607689
    const env = formatPackedEnvironment(scene);
    const guards = [
      motionPromptText(
        'No BGM; generate only environmental sounds and action sounds.',
        promptLocale
      ),
      characterTags.length > 0
        ? motionPromptText('Avoid jitter and bent limbs.', promptLocale)
        : '',
    ].filter((part) => part.length > 0);
    return {
      prompt: [env, list, guards.join('\n')]
        .filter((part) => part.length > 0)
        .join('\n\n'),
    };
  }
  const header = formatPackedHeader({
    promptLocale,
    scene,
    characterTags,
    model,
    generateAudio,
    hasDialogue: shots.some(
      (shot) =>
        shot.motionPrompt?.dialogue?.presence &&
        shot.motionPrompt.dialogue.lines.length > 0
    ),
  });
  if (model === 'kling_v3_pro' || model === 'kling_v4') {
    // Kling rejects `prompt` + `multi_prompt` together, so the header has to
    // live on the first element. Later shots stay action-only.
    return {
      prompt: joinPacked(header, bodies.join('\ncut to\n')),
      multiPrompt: shots.map((shot, i) => ({
        prompt:
          i === 0 ? joinPacked(header, bodies[i] ?? '') : (bodies[i] ?? ''),
        duration:
          model === 'kling_v4'
            ? clampSeconds(shot.durationSeconds, 30)
            : String(clampSeconds(shot.durationSeconds, 15)),
      })),
      ...(model === 'kling_v4' && { maxElementLength: 512 }),
    };
  }

  return {
    prompt: joinPacked(header, list),
  };
}

function uniqueCharacterTags(
  shots: readonly PackedMotionPromptShot[]
): string[] {
  return [...new Set(shots.flatMap((shot) => shot.characterTags ?? []))];
}

function joinPacked(header: string, body: string): string {
  if (header.length === 0) return body;
  if (body.length === 0) return header;
  return `${header}\n\n${body}`;
}

function formatPackedEnvironment(scene?: PackedMotionSceneHeader): string {
  const env = [
    scene?.location,
    scene?.timeOfDay,
    scene?.lightingSetup,
    scene?.colorPalette,
    scene?.look,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('. ');
  return env.length > 0 ? asSentence(env) : '';
}

function formatPackedHeader(input: {
  promptLocale: Locale;
  scene?: PackedMotionSceneHeader;
  characterTags: readonly string[];
  model: ImageToVideoModel;
  generateAudio?: boolean;
  hasDialogue: boolean;
}): string {
  const parts: string[] = [];
  const env = formatPackedEnvironment(input.scene);
  if (env.length > 0) parts.push(env);
  if (input.model === 'minimax_h3_max' && input.generateAudio === false) {
    parts.push(
      `overall_soundscape: ${motionPromptText(SILENT_SOUNDSCAPE, input.promptLocale)}\nnon_diegetic_music: N/A`
    );
  } else if (input.model === 'kling_v4' && input.generateAudio === false) {
    parts.push(motionPromptText(SILENT_SOUNDSCAPE, input.promptLocale));
  } else {
    parts.push(noMusicDirection(input.hasDialogue, input.promptLocale));
    if (input.model === 'minimax_h3_max') {
      parts.push('non_diegetic_music: N/A');
    }
  }
  if (input.characterTags.length > 0) {
    parts.push(
      motionPromptText('Avoid jitter and bent limbs.', input.promptLocale)
    );
  }
  return parts.join('\n\n');
}

function assembleOnePackedShot(
  shot: PackedMotionPromptShot,
  model: ImageToVideoModel,
  generateAudio: boolean | undefined,
  singleTake: boolean,
  omitSharedConstraints: boolean,
  promptLocale: Locale
): string {
  if (shot.motionPrompt) {
    return buildMotionShotPrompt({
      promptLocale,
      motionPrompt: shot.motionPrompt,
      model,
      characterTags: shot.characterTags,
      generateAudio: shot.generateAudio ?? generateAudio,
      singleTake,
      omitSharedConstraints,
    });
  }
  const fallback = shot.prompt ?? '';
  if (singleTake && model === 'gemini_omni_flash' && fallback.length > 0) {
    return `${fallback}\n\n${motionPromptText('Single unbroken scene.', promptLocale)}`;
  }
  return fallback;
}

function formatPackedShotList(
  model: ImageToVideoModel,
  shots: readonly PackedMotionPromptShot[],
  bodies: readonly string[]
): string {
  let elapsed = 0;
  const labeled = shots.map((shot, i) => {
    const dur = Math.max(1, Math.round(shot.durationSeconds));
    const start = elapsed;
    const end = elapsed + dur;
    elapsed = end;
    const n = i + 1;
    const body = bodies[i] ?? '';
    if (model === 'seedance_v2_5') {
      return `Shot ${n} (${start}-${end}s): ${body}`;
    }
    if (model === 'minimax_h3_max') {
      return `Shot ${n} (${start}-${end}s): ${body}`;
    }
    return `Shot ${n}: ${body}`;
  });

  if (
    model === 'seedance_v2' ||
    model === 'seedance_v2_mini' ||
    model === 'gemini_omni_flash'
  ) {
    return labeled.join('\ncut to\n');
  }
  return labeled.join('\n\n');
}

/** Whole seconds in 1…max, for Kling `multi_prompt[].duration`. */
function clampSeconds(seconds: number, max: number): number {
  return Math.min(max, Math.max(1, Math.round(seconds)));
}

// ---------------------------------------------------------------------------
// Kling 3.0: Character labels with tone + temporal markers + ambient sounds
// Guide: https://blog.fal.ai/kling-3-0-prompting-guide/
// ---------------------------------------------------------------------------

function buildKlingPrompt(
  fullPrompt: string,
  dialogue: MotionDialogue | undefined,
  audio: MotionAudio | undefined,
  omitSharedConstraints: boolean,
  promptLocale: Locale
): string {
  const parts = [fullPrompt];

  // Append dialogue with Kling-specific character labels and temporal markers
  if (dialogue) {
    parts.push(formatKlingDialogue(dialogue.lines, promptLocale));
  }

  // Ambient sound woven into the prompt (Kling generates audio natively)
  const ambientParts: string[] = [];
  if (audio?.ambientSound) ambientParts.push(audio.ambientSound);
  if (audio && audio.soundEffects.length > 0)
    ambientParts.push(audio.soundEffects.join(', '));
  if (omitSharedConstraints) {
    if (ambientParts.length > 0) {
      parts.push(
        `${motionPromptText('Ambient sounds', promptLocale)}: ${ambientParts.join('. ')}.`
      );
    }
  } else {
    parts.push(
      ambientParts.length > 0
        ? `${motionPromptText('Ambient sounds', promptLocale)}: ${ambientParts.join('. ')}. ${noMusicDirection(Boolean(dialogue), promptLocale)}`
        : noMusicDirection(Boolean(dialogue), promptLocale)
    );
  }

  return parts.join('\n\n');
}

function formatKlingDialogue(
  lines: DialogueLine[],
  promptLocale: Locale
): string {
  return lines
    .map((line) => {
      const label =
        line.character || motionPromptText('Narrator', promptLocale);
      const tone = line.tone ? `, ${line.tone}` : '';
      return `[${label}${tone}]: "${line.line}"`;
    })
    .join(`\n${motionPromptText('Immediately, ', promptLocale)}`);
}

// ---------------------------------------------------------------------------
// ByteDance Seedance 2.0 / 2.5: sound as natural prose woven into the prompt
// — no labeled sections. One ambient sentence, SFX tied to on-screen actions,
// dialogue kept concise (lip-sync is weaker than SFX/ambience). Neither
// version has negative_prompt or camera_fixed parameters, so guards go
// in-prompt.
//
// The audio DELIMITERS are ByteDance's own parsing convention, not a style
// choice: `{…}` marks the exact words to speak, `<…>` a discrete sound
// effect, `(…)` music. Sending dialogue in plain double quotes (which is what
// this did until #1559) leaves the model to guess where the line starts and
// ends, and lets narrative words either side leak into the spoken take. Note
// `<>` is spent on sound effects here, so character names must never be
// wrapped in angle brackets — the same symbol cannot mean two things.
// Guides: https://fal.ai/learn/devs/bytedance-seedance2-prompts,
// https://docs.byteplus.com/en/docs/ModelArk/2607689
// ---------------------------------------------------------------------------

/** BytePlus's wording for a reference clip that IS the shot's audio (#1657). */
const MASTER_AUDIO_DIRECTION =
  'Exact master audio track; preserve word-for-word delivery, exact vocal timbre, room tone, and sound effects completely intact. Do not replace, remix, or add underlying music.';

function buildSeedancePrompt(
  fullPrompt: string,
  dialogue: MotionDialogue | undefined,
  audio: MotionAudio | undefined,
  characterTags: readonly string[] | undefined,
  singleTake: boolean,
  omitSharedConstraints: boolean,
  promptLocale: Locale
): string {
  const parts = [fullPrompt];

  const soundProse: string[] = [];
  if (audio?.ambientSound) soundProse.push(asSentence(audio.ambientSound));
  if (audio && audio.soundEffects.length > 0) {
    // Each effect gets its own `<>`: they are discrete, separately timed
    // sounds, where ambience is one continuous bed and stays prose.
    soundProse.push(
      audio.soundEffects.map((sfx) => `<${sfx.trim()}>`).join(' ')
    );
  }
  if (soundProse.length > 0) parts.push(soundProse.join(' '));

  if (dialogue) {
    // A line on the conversation recording is NOT repeated here (BytePlus,
    // #1657): with the words in the prompt as well, Seedance re-voices them
    // over the track. The recording is named as the master track and the
    // speakers are pointed at it, in speaking order, for lip-sync.
    const recorded = dialogue.lines.filter(
      (line) => line.voiceToken === DIALOGUE_CLIP_TOKEN
    );
    const spoken = dialogue.lines
      .filter((line) => line.voiceToken !== DIALOGUE_CLIP_TOKEN)
      .map((line) => spokenLine(line, `{${line.line}}`, 'voice', promptLocale));
    if (recorded.length > 0) {
      const speakers = recorded
        .map((line) => line.character)
        .filter((name, at, all) => name && name !== all[at - 1]);
      spoken.unshift(
        `${DIALOGUE_CLIP_TOKEN}: ${motionPromptText(MASTER_AUDIO_DIRECTION, promptLocale)}` +
          (speakers.length > 0
            ? promptLocale === 'zh-CN'
              ? ` 将${speakers.join('，然后')}的口型与${DIALOGUE_CLIP_TOKEN}同步${speakers.length > 1 ? '，按此顺序' : ''}。`
              : ` Lipsync ${speakers.join(', then ')} to ${DIALOGUE_CLIP_TOKEN}${speakers.length > 1 ? ', in that order' : ''}.`
            : '')
      );
    }
    parts.push(spoken.join(' '));
  }

  if (omitSharedConstraints) {
    return parts.join('\n\n');
  }

  // Constraint words, which the ByteDance guide asks for at the end of the
  // prompt. Seedance invents edits otherwise, conflicting with
  // one-scene-one-take — omit that pin when the clip is a packed multi-shot.
  const guards = [noMusicDirection(Boolean(dialogue), promptLocale)];
  if (singleTake) {
    guards.push(
      motionPromptText('Single continuous shot, no cuts.', promptLocale)
    );
  }
  // Standard guard from the ByteDance prompt guide for scenes with characters
  if (characterTags && characterTags.length > 0) {
    guards.push(motionPromptText('Avoid jitter and bent limbs.', promptLocale));
  }
  parts.push(guards.join(' '));

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// MiniMax H3 Max: the model's native prompt is three labelled sections —
// `integrated_multimodal_description` (with dialogue as `<d>[Lang] …</d>`),
// `overall_soundscape`, and `non_diegetic_music`. fal's prompt expander
// rewrites whatever we send into that shape, so the no-music intent has to be
// explicit or the expander invents a score. `non_diegetic_music: N/A` is the
// documented off value.
// Spec: https://platform.minimax.io/docs/api-reference/video-generation-v2-h3-context-ir
// ---------------------------------------------------------------------------

function buildMinimaxH3Prompt(
  fullPrompt: string,
  dialogue: MotionDialogue | undefined,
  audio: MotionAudio | undefined,
  generateAudio: boolean | undefined,
  omitSharedConstraints: boolean,
  promptLocale: Locale
): string {
  const parts = [fullPrompt];

  // No API switch: "off" is a silent soundscape and no dialogue lines.
  // Packed clips put that clip-wide silence in the header.
  if (generateAudio === false) {
    if (!omitSharedConstraints) {
      parts.push(
        `overall_soundscape: ${motionPromptText(SILENT_SOUNDSCAPE, promptLocale)}\nnon_diegetic_music: N/A`
      );
    }
    return parts.join('\n\n');
  }

  if (dialogue) {
    // ponytail: dialogue lines carry no language; assume English until the
    // scene schema records one.
    parts.push(
      dialogue.lines
        .map((line) =>
          spokenLine(
            line,
            `<d>[English] ${line.line}</d>`,
            'tone',
            promptLocale
          )
        )
        .join(' ')
    );
  }

  const soundscape: string[] = [];
  if (audio?.ambientSound) soundscape.push(asSentence(audio.ambientSound));
  if (audio && audio.soundEffects.length > 0)
    soundscape.push(asSentence(audio.soundEffects.join(', ')));
  if (omitSharedConstraints) {
    if (soundscape.length > 0) {
      parts.push(`overall_soundscape: ${soundscape.join(' ')}`);
    }
    return parts.join('\n\n');
  }
  soundscape.push(noMusicDirection(Boolean(dialogue), promptLocale));
  parts.push(
    `overall_soundscape: ${soundscape.join(' ')}\nnon_diegetic_music: N/A`
  );

  return parts.join('\n\n');
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Bind the raw recording token and transcript in one speaking event to avoid repetition. */
function spokenLine(
  line: DialogueLine,
  words: string,
  toneNoun: 'voice' | 'tone',
  promptLocale: Locale
): string {
  const subject = line.character || motionPromptText('A voice', promptLocale);
  if (
    line.voiceToken === DIALOGUE_CLIP_TOKEN ||
    isElementVoiceToken(line.voiceToken)
  ) {
    return promptLocale === 'zh-CN'
      ? `${subject}完全按照${line.voiceToken}中的录音说出这句台词：${words}`
      : `${subject} speaks this line exactly as recorded in ${line.voiceToken}: ${words}`;
  }
  if (promptLocale === 'zh-CN') {
    const tone = line.tone
      ? `以${line.tone}的${toneNoun === 'voice' ? '嗓音' : '语气'}`
      : '';
    return `${subject}${tone}说：${words}`;
  }
  const tone = line.tone ? ` in a ${line.tone} ${toneNoun}` : '';
  return `${subject} says${tone}: ${words}`;
}

// ---------------------------------------------------------------------------
// Default narrative style (Veo / Sora guides): quotes + Audio: section. No
// catalog model routes here today; it stays the fallback for a new vendor.
// Guide: https://fal.ai/learn/devs/veo3-prompt-guide
// ---------------------------------------------------------------------------

function buildVeoPrompt(
  fullPrompt: string,
  dialogue: MotionDialogue | undefined,
  audio: MotionAudio | undefined,
  omitSharedConstraints: boolean,
  promptLocale: Locale
): string {
  const parts = [fullPrompt];

  // Append dialogue as natural narrative with inline quotes
  if (dialogue) {
    const dialogueNarrative = dialogue.lines
      .map((line) => {
        const subject =
          line.character || motionPromptText('A voice', promptLocale);
        if (promptLocale === 'zh-CN') {
          const tone = line.tone ? `以${line.tone}的嗓音` : '';
          return `${subject}${tone}说：“${line.line}”`;
        }
        const tone = line.tone ? ` in a ${line.tone} voice` : '';
        return `${subject} says${tone}, "${line.line}"`;
      })
      .join('. ');
    parts.push(dialogueNarrative + '.');
  }

  // Separate Audio: section (Veo guide recommendation)
  const audioParts: string[] = [];
  if (audio?.ambientSound) audioParts.push(audio.ambientSound);
  if (audio && audio.soundEffects.length > 0)
    audioParts.push(audio.soundEffects.join(', '));
  if (omitSharedConstraints) {
    if (audioParts.length > 0) {
      parts.push(
        `${motionPromptText('Audio', promptLocale)}: ${audioParts.join('. ')}.`
      );
    }
    return parts.join('\n\n');
  }
  parts.push(
    audioParts.length > 0
      ? `${motionPromptText('Audio', promptLocale)}: ${audioParts.join('. ')}. ${noMusicDirection(Boolean(dialogue), promptLocale)}`
      : `${motionPromptText('Audio', promptLocale)}: ${noMusicDirection(Boolean(dialogue), promptLocale)}`
  );

  return parts.join('\n\n');
}
