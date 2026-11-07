import type { TFunction } from 'i18next';
import { useLocaleFormatting } from '@/ui/i18n/use-formatting';
import { useTranslation } from 'react-i18next';
/**
 * The dialogue an audio-capable video model will be told to speak (#1559).
 *
 * The lines are the shot's dialogue node (`shot_dialogue_versions`; the
 * script only seeds it), shown and edited through the `lineList` slot (#1773). Audio is one choice
 * for the whole shot (#1554): the generated take, a user-uploaded audio
 * element, or the video model inventing the voices. Per-line binding was
 * the old grain; the take is a conversation, not a character.
 *
 * It sits under the shot's video, the one place a shot's dialogue is
 * edited, heard and recorded. The audio choice is a write of the shot's
 * lines (a `voiceToken` on each), so it needs no motion prompt.
 */

import { formatElementDuration } from '@/cast/element-kind';
import {
  dialogueModelLabel,
  GENERATED_VOICE,
  VIDEO_MODEL_VOICE_TOKEN,
  orphanedVoiceTokens,
  persistToken,
  shotPickerValue,
} from '@/motion/dialogue-tts';
import { dialogueExceedsShotDuration } from '@/motion/resolve-shot-duration';
import type { SequenceElementMinimal } from '@/platform/server/db/schema';
import type {
  DialogueLine,
  MotionDialogue,
} from '@/shots/scene-analysis.schema';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/shadcn/alert-dialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/ui/shadcn/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';

type DialogueClip = {
  url: string;
  durationSeconds: number | null;
};

/**
 * One reading of this shot's lines (#1657): a time range of a speech.
 * The whole speech is the file; the range rides the URL as a media
 * fragment, so one file serves every shot it spoke.
 */
export type ShotDialogueReading = {
  id: string;
  /**
   * `context`: spoken while generating another shot, never adopted here.
   * `mic`: a line performed by the user, in the speaker's voice (#1802).
   */
  source: 'generated' | 'context' | 'mic' | 'upload';
  selected: boolean;
  fromSeconds: number;
  toSeconds: number;
  speechUrl: string;
  /** The model the speech ran on (`ttsModel` of its turns). */
  model: string;
  createdAt: Date | string;
  /** False once the shot's lines or voices moved — it cannot be used. */
  matchesCurrentLines: boolean;
  /** Lines the take check could not find; the take was kept anyway. */
  unclearLineCount: number;
  /** Why it no longer matches: the words moved, or only the voice did. */
  mismatch: 'lines' | 'voice' | null;
};

function voiceLabel(element: SequenceElementMinimal): string {
  const length = formatElementDuration(element.durationSeconds);
  return length ? `${element.token} · ${length}` : element.token;
}

/** What the shot's one audio choice plays: the generated clip or a bound element. */
export function shotPlayback(
  lines: readonly DialogueLine[],
  voices: SequenceElementMinimal[],
  clip: DialogueClip | null | undefined
) {
  const value = shotPickerValue(lines);
  const bound = voices.find((el) => el.token === value);
  const generated = value === GENERATED_VOICE;
  return {
    value,
    url: generated ? (clip?.url ?? null) : (bound?.imageUrl ?? null),
    seconds: generated
      ? (clip?.durationSeconds ?? null)
      : (bound?.durationSeconds ?? null),
  };
}

/**
 * Who speaks the lines when it is not the generated reading (#1773): the
 * reading is then not in use, so it can be neither out of date nor worth
 * regenerating. Null on Generated.
 */
export function shotSpokenByNote(
  lines: readonly DialogueLine[],
  translate?: TFunction<'shots'>
): string | null {
  const value = shotPickerValue(lines);
  if (lines.length === 0 || value === GENERATED_VOICE) return null;
  return value === VIDEO_MODEL_VOICE_TOKEN
    ? (translate?.('Video model speaks the lines', { ns: 'shots' }) ??
        'Video model speaks the lines')
    : (translate?.('{{value1}} speaks the lines', {
        ns: 'shots',
        value1: value,
      }) ?? `${value} speaks the lines`);
}

const ReadingRow: React.FC<{
  reading: ShotDialogueReading;
  onUse: (readingId: string) => void;
  onDiscard: (reading: ShotDialogueReading) => void;
  usingId?: string | null;
}> = ({ reading, onUse, onDiscard, usingId }) => {
  const { formatDateTime } = useLocaleFormatting();
  const { t } = useTranslation('shots');

  const recordedAt = formatDateTime(new Date(reading.createdAt));
  const facts = [
    recordedAt,
    formatElementDuration(reading.toSeconds - reading.fromSeconds),
    reading.source === 'context' ? t('Generated with another shot') : null,
    reading.source === 'mic' ? t('Your take') : null,
    reading.source === 'upload' ? t('Your recording') : null,
    reading.unclearLineCount > 0
      ? t('{{value1}} {{value2}} may not be said clearly', {
          value1: reading.unclearLineCount,
          value2: reading.unclearLineCount === 1 ? t('line') : t('lines'),
        })
      : null,
    reading.mismatch === 'voice'
      ? t('Voice changed since')
      : reading.mismatch === 'lines'
        ? t('Lines changed since')
        : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{dialogueModelLabel(reading.model)}</Badge>
          {facts.join(' · ')}
        </span>
        <div className="flex items-center gap-1">
          {reading.selected ? (
            <span className="flex items-center gap-1 text-xs font-medium">
              <Check className="h-3 w-3" aria-hidden />
              {t('Current')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={usingId != null || !reading.matchesCurrentLines}
              aria-label={t('Use reading from {{value1}}', {
                value1: recordedAt,
              })}
              onClick={() => onUse(reading.id)}
            >
              {usingId === reading.id ? t('Using…') : t('Use')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={usingId != null}
            aria-label={t('Discard reading from {{value1}}', {
              value1: recordedAt,
            })}
            onClick={() => onDiscard(reading)}
          >
            {t('Discard')}
          </Button>
        </div>
      </div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a reading of the lines shown beside it */}
      <audio
        controls
        preload="none"
        src={`${reading.speechUrl}#t=${reading.fromSeconds},${reading.toSeconds}`}
        className="w-full"
        aria-label={t('Reading from {{value1}}', { value1: recordedAt })}
      />
    </li>
  );
};

/**
 * This shot's readings, newest first. Boxed it shows
 * only when there is something to pick or the current one went stale;
 * `collapsible` (under the video) it always holds its one row, so the block
 * does not move when the list lands.
 */
export const ShotReadingsList: React.FC<{
  readings: ShotDialogueReading[];
  onUse: (readingId: string) => void;
  onDiscard: (readingId: string) => void;
  usingId?: string | null;
  collapsible?: boolean;
}> = ({ readings, onUse, onDiscard, usingId, collapsible }) => {
  const { t } = useTranslation('shots');

  const [pendingDiscard, setPendingDiscard] =
    useState<ShotDialogueReading | null>(null);
  const rows = (
    <>
      <ul className="flex flex-col gap-3">
        {readings.map((reading) => (
          <ReadingRow
            key={reading.id}
            reading={reading}
            onUse={onUse}
            onDiscard={setPendingDiscard}
            usingId={usingId}
          />
        ))}
      </ul>
      <AlertDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Discard this reading?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDiscard?.selected
                ? t(
                    'It is the shot’s current audio. The next render records a new one.'
                  )
                : t('It leaves this list. The recording it came from is kept.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDiscard) onDiscard(pendingDiscard.id);
                setPendingDiscard(null);
              }}
            >
              {t('Discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  if (collapsible) {
    if (readings.length === 0) {
      return (
        <p className="flex h-8 items-center text-xs text-muted-foreground">
          {t('No readings yet')}
        </p>
      );
    }
    return (
      <Collapsible className="flex flex-col gap-2">
        <CollapsibleTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="group h-8 justify-between"
          >
            {t('Readings ·')} {readings.length}
            <ChevronDown
              className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>{rows}</CollapsibleContent>
      </Collapsible>
    );
  }
  // A lone current reading says nothing new — unless it no longer matches
  // (the voice or the lines moved), which is the one fact worth a row.
  if (readings.every((r) => r.selected && r.matchesCurrentLines)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <span className="text-xs font-medium">{t('Readings')}</span>
      {rows}
    </div>
  );
};

/** A speaker in this shot with no voice to record them in (#1773). */
export type MissingVoiceRow = {
  characterId: string;
  name: string;
  /** A voice is being designed for them now. */
  generating: boolean;
};

/**
 * "Aria has no voice" with a way to make one. Lines are recorded only in a
 * cast member's voice, so without it "Generate dialogue" has nothing to say.
 * `onGenerate` is null where voices cannot be designed on this deployment.
 */
export const ShotMissingVoices: React.FC<{
  speakers: MissingVoiceRow[];
  onGenerate: ((characterId: string) => void) | null;
  /** Shown beside the button: what one design costs. */
  cost?: React.ReactNode;
}> = ({ speakers, onGenerate, cost }) => {
  const { t } = useTranslation('shots');
  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {speakers.map((speaker) => (
        <li
          key={speaker.characterId}
          className="flex min-h-8 items-center justify-between gap-2"
        >
          <span className="text-xs text-muted-foreground">
            {speaker.generating
              ? t('Generating {{value1}}’s voice…', { value1: speaker.name })
              : t('{{value1}} has no voice', { value1: speaker.name })}
          </span>
          {onGenerate && !speaker.generating ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={t('Generate a voice for {{value1}}', {
                value1: speaker.name,
              })}
              onClick={() => onGenerate(speaker.characterId)}
            >
              <span className="inline-flex items-center gap-2">
                {t('Generate voice')}
                {cost}
              </span>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

/** A dialogue speech in flight for this shot (#1657). */
export type ShotDialogueClaimRow = {
  id: string;
  /** False once the user acted: it still records, but will not take over. */
  willBecomeCurrent: boolean;
};

/**
 * "Generating…" — one row per speech in flight, with the same way out every
 * other generation has. Cancel does not stop the run (it records the scene for
 * other shots too); it stops the reading from becoming this shot's audio.
 */
export const ShotSpeechesInFlight: React.FC<{
  claims: ShotDialogueClaimRow[];
  onCancel: (claimId: string) => void;
  cancellingId?: string | null;
}> = ({ claims, onCancel, cancellingId }) => {
  const { t } = useTranslation('shots');

  if (claims.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {claims.map((claim) => (
        <li
          key={claim.id}
          className="flex min-h-8 items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              className="h-3 w-3 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            {claim.willBecomeCurrent
              ? t('Generating…')
              : t('Generating… will not replace the current audio')}
          </span>
          {claim.willBecomeCurrent ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={cancellingId != null}
              onClick={() => onCancel(claim.id)}
            >
              {cancellingId === claim.id ? t('Cancelling…') : t('Cancel')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

/** One authored version of a shot's lines, as the history list shows it. */
export type ShotDialogueVersionRow = {
  id: string;
  source: 'prompt' | 'user-edit';
  createdAt: Date | string;
  selected: boolean;
  lines: readonly { character: string; line: string }[];
  /** Same words as the version before it: only the audio source moved (#1773). */
  voiceOnly: boolean;
};

const DIALOGUE_VERSION_SOURCE_LABELS = {
  prompt: 'From the script',
  'user-edit': 'Edited',
} as const;

/**
 * Every set of lines this shot has held (#1657), newest first, with a way
 * back. Hidden until there is something to go back to.
 */
export const ShotDialogueHistory: React.FC<{
  versions: ShotDialogueVersionRow[];
  onUse: (versionId: string) => void;
  usingId?: string | null;
}> = ({ versions, onUse, usingId }) => {
  const { formatDateTime } = useLocaleFormatting();
  const { t } = useTranslation('shots');

  if (versions.length < 2) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-md border p-3"
      aria-label={t('Dialogue history')}
    >
      <span className="text-xs font-medium">{t('History')}</span>
      <ul className="flex flex-col gap-1">
        {versions.map((version) => {
          const created = new Date(version.createdAt);
          const said =
            version.lines.length === 0
              ? 'No lines'
              : version.lines.map((line) => `“${line.line}”`).join(' ');
          return (
            <li
              key={version.id}
              className="flex min-h-8 items-center justify-between gap-2"
              aria-current={version.selected ? 'true' : undefined}
            >
              <div className="flex min-w-0 flex-col">
                <p className="text-xs font-medium">
                  {version.voiceOnly
                    ? t('Audio source changed')
                    : DIALOGUE_VERSION_SOURCE_LABELS[version.source]}{' '}
                  <time
                    dateTime={created.toISOString()}
                    className="font-normal text-muted-foreground"
                  >
                    {formatDateTime(created)}
                  </time>
                </p>
                <p className="truncate text-xs text-muted-foreground">{said}</p>
              </div>
              {version.selected ? (
                <span className="flex items-center gap-1 text-xs font-medium">
                  <Check className="h-3 w-3" aria-hidden />
                  {t('Current')}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={usingId != null}
                  aria-label={t('Use lines from {{value1}}', {
                    value1: formatDateTime(created),
                  })}
                  onClick={() => onUse(version.id)}
                >
                  {usingId === version.id ? t('Using…') : t('Use')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const MotionDialoguePanel: React.FC<{
  dialogue: MotionDialogue | null | undefined;
  elements: SequenceElementMinimal[] | undefined;
  /** Null while the model takes no audio at all — the lines still show. */
  onChange: ((next: MotionDialogue) => void) | null;
  disabled?: boolean;
  /** References-stage take for this shot, when one exists. */
  clip?: DialogueClip | null;
  /** Shot duration in seconds — noted only when the take is longer. */
  shotSeconds?: number;
  /** This shot's readings list (#1657) — a slot, so the panel stays presentational. */
  readings?: React.ReactNode;
  /** The lines, with Record and Edit on each (`DialogueLineRows`). */
  lineList: React.ReactNode;
  /** Beside the heading: Play dialogue. */
  play?: React.ReactNode;
}> = ({
  dialogue,
  elements,
  onChange,
  disabled,
  clip,
  shotSeconds,
  readings,
  lineList,
  play,
}) => {
  const { t } = useTranslation('shots');

  const lines = dialogue?.presence ? dialogue.lines : [];
  const heading = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{t('Dialogue')}</span>
      {play}
    </div>
  );
  if (lines.length === 0) {
    // A shot with no lines still gets the section, so lines can be added
    // under the video too (#1780 §7) — the list carries Add line.
    return (
      <div className="flex flex-col gap-2">
        {heading}
        {lineList}
      </div>
    );
  }

  const voices = (elements ?? []).filter((el) => el.kind === 'audio');
  const generatedLabel = (() => {
    const length = formatElementDuration(clip?.durationSeconds ?? null);
    return length
      ? t('Generated · {{value1}}', { value1: length })
      : 'Generated';
  })();
  const { value, seconds: audioSeconds } = shotPlayback(lines, voices, clip);
  const orphans =
    elements === undefined
      ? []
      : orphanedVoiceTokens(lines, new Set(voices.map((el) => el.token)));
  const voiceItems: Record<string, string> = {
    [GENERATED_VOICE]: generatedLabel,
    [VIDEO_MODEL_VOICE_TOKEN]: t('Video model'),
    ...Object.fromEntries(voices.map((el) => [el.token, voiceLabel(el)])),
    ...Object.fromEntries(
      orphans.map((token) => [
        token,
        t('{{value1}} (deleted)', { value1: token }),
      ])
    ),
  };
  const dialogueLonger = dialogueExceedsShotDuration(audioSeconds, shotSeconds);

  const setShotVoice = (next: string) => {
    if (!onChange) return;
    const voiceToken = persistToken(next);
    onChange({
      presence: true,
      lines: lines.map((line) => ({ ...line, voiceToken })),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {heading}
      <p className="text-xs text-muted-foreground">
        {t('Appended to the prompt at render')}
      </p>
      {onChange && (
        <Select
          value={value}
          items={voiceItems}
          onValueChange={(next) => {
            if (typeof next === 'string') setShotVoice(next);
          }}
          disabled={disabled}
        >
          <SelectTrigger
            size="sm"
            className="w-full"
            aria-label={t('Shot audio')}
          >
            <SelectValue placeholder={t('Generated')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GENERATED_VOICE}>{generatedLabel}</SelectItem>
            <SelectItem value={VIDEO_MODEL_VOICE_TOKEN}>
              {t('Video model')}
            </SelectItem>
            {voices.map((el) => (
              <SelectItem key={el.id} value={el.token}>
                <span>{voiceLabel(el)}</span>
              </SelectItem>
            ))}
            {orphans.map((token) => (
              <SelectItem key={token} value={token}>
                <span>{t('{{value1}} (deleted)', { value1: token })}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {orphans.length > 0 && (
        <p className="text-xs text-warning">
          {t(
            "{{value1}} was deleted — pick another source, or this shot won't render.",
            { value1: orphans.join(', ') }
          )}
        </p>
      )}
      {dialogueLonger && audioSeconds != null && shotSeconds != null && (
        <p className="text-xs text-muted-foreground">
          {t(
            'Dialogue is {{value1}} — this shot is {{value2}}. Generate will stretch the shot to cover it.',
            {
              value1: formatElementDuration(audioSeconds),
              value2: formatElementDuration(shotSeconds),
            }
          )}
        </p>
      )}
      {lineList}
      {readings}
      {!onChange && (
        <p className="text-xs text-muted-foreground">
          {t(
            'This model generates its own voices — it takes no audio reference.'
          )}
        </p>
      )}
    </div>
  );
};
