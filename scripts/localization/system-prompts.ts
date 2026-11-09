import { sourceFingerprint } from './ast';
import type { SourceSnapshot } from './git-snapshot';

const REGISTRY_CHINESE = [
  'src/platform/server/ai/prompts/zh-CN/text.ts',
  'src/platform/server/ai/prompts/zh-CN/audio.ts',
  'src/platform/server/ai/prompts/zh-CN/cast.ts',
  'src/platform/server/ai/prompts/zh-CN/rewrite.ts',
  'src/platform/server/ai/prompts/zh-CN/scenes.ts',
  'src/platform/server/ai/prompts/zh-CN/guidance.ts',
  'src/platform/server/ai/prompts/zh-CN/index.ts',
];
const AUXILIARY = 'src/models/server/auxiliary-prompts.ts';
const VISION = 'src/cast/server/vision-prompts.zh-cn.ts';
const PROMPT_PAIRS: Record<string, string[]> = {
  'src/platform/server/ai/workflow-prompts.ts': REGISTRY_CHINESE,
  'src/assistant/server/assistant-chat.ts': [
    'src/assistant/server/assistant-prompts.ts',
  ],
  'src/assistant/page-context.ts': ['src/assistant/page-context-prompts.ts'],
  'src/studio/server/studio-prompt-draft.ts': [
    'src/studio/server/studio-prompt-draft-prompts.ts',
  ],
  'src/models/ai.fn.ts': [AUXILIARY],
  'src/models/server/watch-clip.ts': [AUXILIARY],
  'src/cast/server/describe-upload.ts': [VISION],
  'src/cast/server/element-vision.ts': [VISION],
  'src/cast/server/talent-vision.ts': [VISION],
  'src/sequences/script-enhancer.ts': ['src/sequences/enhance-prompt.ts'],
};
const BILINGUAL_OWNERS = new Set([
  'src/models/enhance-duration.ts',
  'src/sequences/server/scene-split-prompts.ts',
  'src/sequences/server/script-enhancement.ts',
]);
const PROMPT_CANDIDATE =
  /^src\/(?!.*\/ui\/).*(?:\/prompts\/.*|prompt[^/]*)\.tsx?$/;

function classifyPrompt(file: string) {
  const targets = PROMPT_PAIRS[file];
  if (targets)
    return {
      kind: 'english-owner',
      targets,
      reason: 'english-owner-module-changed',
    };
  if (BILINGUAL_OWNERS.has(file))
    return {
      kind: 'bilingual-owner',
      targets: [file],
      reason: 'bilingual-owner-module-changed-language-not-inferred',
    };
  const sources = Object.entries(PROMPT_PAIRS)
    .filter(([, paths]) => paths.includes(file))
    .map(([source]) => source);
  if (sources.length)
    return {
      kind: 'localized-counterpart',
      targets: sources,
      reason: 'localized-module-changed',
    };
  return PROMPT_CANDIDATE.test(file)
    ? {
        kind: 'unmapped-candidate',
        targets: [],
        reason: 'unmapped-prompt-source-candidate',
      }
    : undefined;
}

function snapshotFingerprint(snapshot: SourceSnapshot, file: string) {
  return snapshot.files.has(file)
    ? sourceFingerprint(snapshot.read(file), file)
    : null;
}

function counterpart(
  file: string,
  before: SourceSnapshot,
  after: SourceSnapshot
) {
  const oldFingerprint = snapshotFingerprint(before, file);
  const newFingerprint = snapshotFingerprint(after, file);
  return {
    file,
    before: oldFingerprint,
    after: newFingerprint,
    changed: oldFingerprint !== newFingerprint,
    existsAfter: after.files.has(file),
  };
}

export function comparePromptSource(
  file: string,
  beforeSource: string | undefined,
  afterSource: string | undefined,
  before: SourceSnapshot,
  after: SourceSnapshot
) {
  const classification = classifyPrompt(file);
  if (!classification) return undefined;
  const oldFingerprint =
    beforeSource === undefined ? null : sourceFingerprint(beforeSource, file);
  const newFingerprint =
    afterSource === undefined ? null : sourceFingerprint(afterSource, file);
  if (oldFingerprint === newFingerprint) return undefined;
  return {
    file,
    sourceKind: classification.kind,
    before: oldFingerprint,
    after: newFingerprint,
    reason: classification.reason,
    counterparts: classification.targets.map((target) =>
      counterpart(target, before, after)
    ),
    status: 'needs_review',
    precision: 'whole-module-conservative-trigger',
    semanticApproval: false,
  };
}
