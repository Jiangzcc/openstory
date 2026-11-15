/**
 * A voice-only character (#1585) gets a row but never a sheet child: nothing
 * to draw, nothing to bill, nothing for the References stage to wait on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@/platform/logger';
import type { CharacterBibleEntry } from '@/shots/scene-analysis.schema';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  CharacterBibleWorkflowInput,
  CharacterSheetWorkflowInput,
} from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import { castChannelId } from '@/cast/cast-channel';

const ENGINE_ABORT_MESSAGES = [
  'Aborting engine: Grace period complete',
  'Durable Object reset because its code was updated',
] as const;

const mockSpawnAndAwaitChild = vi.fn();
const mockFailSheetClaim = vi.fn(async () => undefined);
const mockEmit = vi.fn();
const mockGetGenerationChannel = vi.fn();

vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild: mockSpawnAndAwaitChild,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: mockGetGenerationChannel,
}));

const { CharacterBibleWorkflow } = await import('./character-bible-workflow');

class Probe extends CharacterBibleWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<CharacterBibleWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  // tests construct the entrypoint directly; runImpl never reads ctx
  const ctx = asStub<Ctor[0]>(undefined);
  // the binding is only handed to the (mocked) spawn
  const env = asStub<Ctor[1]>({
    CHARACTER_SHEET_WORKFLOW: {},
    CHARACTER_VOICE_WORKFLOW: {},
  });
  return new Probe(ctx, env);
}

function makeStep(): WorkflowStep {
  // minimal WorkflowStep stub: runImpl only uses `do`
  return asStub<WorkflowStep>({
    do: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  });
}

function makeRetryingStep(stepName: string, firstError: Error): WorkflowStep {
  // Mock one engine retry after the durable failure callback rejects.
  return asStub<WorkflowStep>({
    do: vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      if (name === stepName) await expect(fn()).rejects.toBe(firstError);
      return fn();
    }),
  });
}

// The upsert's row, as a scoped read returns it: wearing its default look,
// which takes the character's own id (#2015).
const characterCreate = vi.fn(
  async (row: {
    id: string;
    characterId: string;
    standardClothing?: string | null;
  }) => ({
    ...row,
    selectedBibleVersionId: `bible-${row.id}`,
    lookId: row.id,
    lookName: 'Default',
    looks: [
      {
        id: row.id,
        isDefault: true,
        lookVersionId: `lookver-${row.id}`,
        name: 'Default',
        clothing: row.standardClothing ?? null,
        styling: null,
      },
    ],
  })
);
const claimSheet = vi.fn(async (lookId: string) => ({
  versionId: `ver-${lookId}`,
  held: true,
}));
const createPendingVoiceClaim = vi.fn(
  async (): Promise<{
    version: { id: string; workflowRunId: string | null };
    created: boolean;
  }> => ({
    version: { id: 'husk-1', workflowRunId: null },
    created: true,
  })
);
const markVoiceClaimTerminal = vi.fn(async () => ({ id: 'husk-1' }));

function makeScopedDb(): WorkflowScopedDb {
  // stub covering only the scoped-db surface runImpl touches
  return asStub<WorkflowScopedDb>({
    inputManifests: {
      record: async () => undefined,
      getByHashes: async () => new Map(),
    },
    characters: {
      create: characterCreate,
      createPendingVoiceClaim,
      markVoiceClaimTerminal,
    },
    characterLooks: { claimSheet, failSheetClaim: mockFailSheetClaim },
  });
}

const entry = (
  overrides: Partial<CharacterBibleEntry> & { characterId: string }
): CharacterBibleEntry => ({
  name: overrides.characterId,
  age: '',
  gender: '',
  ethnicity: '',
  physicalDescription: '',
  standardClothing: '',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: 'Photoreal live action',
  consistencyTag: overrides.characterId,
  ...overrides,
});

const sam = entry({
  characterId: 'sam',
  name: 'Sam',
  physicalDescription: 'wiry',
});
const narrator = entry({
  characterId: 'narrator',
  name: 'Narrator',
  personality: 'dry, unhurried, faintly amused',
  voiceOnly: true,
  isPerson: true,
  rendering: 'Photoreal live action',
});

function makeEvent(
  characterBible: CharacterBibleEntry[] = [sam, narrator],
  opts: { generateVoices?: boolean; speakingCharacterIds?: string[] } = {}
): Readonly<WorkflowEvent<CharacterBibleWorkflowInput>> {
  return {
    payload: {
      promptLocale: 'en',
      userId: 'u1',
      organizationId: 'organization-1',
      sequenceId: 'seq-1',
      characterBible,
      generateVoices: opts.generateVoices ?? false,
      speakingCharacterIds: opts.speakingCharacterIds ?? [],
      analysisModelId: 'anthropic/claude-sonnet-5.5',
    },
    instanceId: 'run-1',
    workflowName: 'character-bible',
    timestamp: new Date(0),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawnAndAwaitChild.mockResolvedValue({
    sheetImageUrl: '/r2/characters/sam.png',
    sheetVersionId: 'ver-sam',
  });
  mockFailSheetClaim.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue(undefined);
  mockGetGenerationChannel.mockReturnValue({ emit: mockEmit });
});

afterEach(() => vi.restoreAllMocks());

describe('CharacterBibleWorkflow voice-only characters', () => {
  it('creates the row completed with no sheet and spawns no child for it', async () => {
    const result = await makeWorkflow().runBody(
      makeEvent(),
      makeStep(),
      makeScopedDb()
    );

    expect(characterCreate).toHaveBeenCalledTimes(2);
    expect(characterCreate.mock.calls.map(([row]) => row)).toEqual([
      expect.objectContaining({
        characterId: 'sam',
        voiceOnly: false,
        isPerson: true,
        rendering: 'Photoreal live action',
        sheetStatus: 'generating',
      }),
      expect.objectContaining({
        characterId: 'narrator',
        voiceOnly: true,
        isPerson: true,
        rendering: null,
        sheetStatus: 'completed',
      }),
    ]);

    expect(mockSpawnAndAwaitChild).toHaveBeenCalledTimes(1);
    expect(mockSpawnAndAwaitChild.mock.calls[0]?.[1]).toMatchObject({
      childPayload: { characterName: 'Sam' },
    });

    expect(result).toEqual([
      expect.objectContaining({
        characterId: 'sam',
        sheetImageUrl: '/r2/characters/sam.png',
        selectedSheetVersionId: 'ver-sam',
      }),
      expect.objectContaining({
        characterId: 'narrator',
        sheetStatus: 'completed',
        sheetImageUrl: null,
        selectedSheetVersionId: null,
      }),
    ]);
  });

  it('keeps the sequence at casting when a sheet fails with the narrator listed first (#1727)', async () => {
    mockSpawnAndAwaitChild.mockRejectedValueOnce(new Error('fal 500'));
    const result = await makeWorkflow().runBody(
      makeEvent([narrator, sam]),
      makeStep(),
      makeScopedDb()
    );

    expect(result).toEqual([
      expect.objectContaining({
        characterId: 'sam',
        name: 'Sam',
        sheetStatus: 'failed',
        sheetImageUrl: null,
        selectedSheetVersionId: null,
      }),
      expect.objectContaining({
        characterId: 'narrator',
        sheetStatus: 'completed',
        sheetImageUrl: null,
        selectedSheetVersionId: null,
      }),
    ]);
  });

  it('returns the sheets that landed when a sibling sheet fails (#1727)', async () => {
    const pat = entry({ characterId: 'pat', name: 'Pat' });
    mockSpawnAndAwaitChild.mockImplementation(async (_step, args) => {
      if (args.childPayload.characterName === 'Sam') {
        throw new Error('fal 500');
      }
      return {
        sheetImageUrl: '/r2/characters/pat.png',
        sheetVersionId: 'ver-pat',
      };
    });

    const result = await makeWorkflow().runBody(
      makeEvent([sam, pat]),
      makeStep(),
      makeScopedDb()
    );

    expect(result).toEqual([
      expect.objectContaining({
        characterId: 'sam',
        sheetStatus: 'failed',
        sheetImageUrl: null,
      }),
      expect.objectContaining({
        characterId: 'pat',
        sheetStatus: 'completed',
        sheetImageUrl: '/r2/characters/pat.png',
        selectedSheetVersionId: 'ver-pat',
      }),
    ]);
  });

  it('clears a held sheet claim and emits failure when the sheet child never starts', async () => {
    mockSpawnAndAwaitChild.mockRejectedValueOnce(
      new Error('workflow binding missing')
    );

    const result = await makeWorkflow().runBody(
      makeEvent([sam]),
      makeStep(),
      makeScopedDb()
    );
    const [row] = characterCreate.mock.calls[0] ?? [];
    if (!row) throw new Error('expected the character row');

    expect(mockFailSheetClaim).toHaveBeenCalledWith(
      row.id,
      `ver-${row.id}`,
      'workflow binding missing'
    );
    expect(mockGetGenerationChannel).toHaveBeenCalledWith(
      castChannelId('seq-1', row.id)
    );
    expect(mockEmit).toHaveBeenCalledWith(
      'generation.character-sheet:progress',
      {
        characterId: row.id,
        lookId: row.id,
        status: 'failed',
        error: 'workflow binding missing',
      }
    );
    expect(result[0]).toMatchObject({ sheetStatus: 'failed' });
  });

  it('does not duplicate a sheet failure already owned by the child', async () => {
    mockSpawnAndAwaitChild.mockRejectedValueOnce(
      new Error(
        'Child workflow character-sheet:sam failed: Error: provider refused'
      )
    );

    const result = await makeWorkflow().runBody(
      makeEvent([sam]),
      makeStep(),
      makeScopedDb()
    );

    expect(mockFailSheetClaim).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'Child workflow character-sheet:sam failed: Error: provider refused'
    );
    expect(mockGetGenerationChannel).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ sheetStatus: 'failed' });
  });

  it('retries child-failure sheet cleanup without repeating its broadcast', async () => {
    const cleanupError = new Error('database down');
    mockSpawnAndAwaitChild.mockRejectedValueOnce(
      new Error('Child workflow character-sheet:sam failed: provider refused')
    );
    mockFailSheetClaim.mockRejectedValueOnce(cleanupError);

    await makeWorkflow().runBody(
      makeEvent([sam]),
      makeRetryingStep('fail-character-sheet-0', cleanupError),
      makeScopedDb()
    );

    expect(mockFailSheetClaim).toHaveBeenCalledTimes(2);
    expect(mockGetGenerationChannel).not.toHaveBeenCalled();
  });

  it('keeps the sheet failure when its realtime event cannot be emitted', async () => {
    mockSpawnAndAwaitChild.mockRejectedValueOnce(
      new Error('workflow binding missing')
    );
    mockEmit.mockRejectedValueOnce(new Error('realtime unavailable'));

    const result = await makeWorkflow().runBody(
      makeEvent([sam]),
      makeStep(),
      makeScopedDb()
    );

    expect(mockFailSheetClaim).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'workflow binding missing'
    );
    expect(result[0]).toMatchObject({ sheetStatus: 'failed' });
  });

  it('leaves a missed sheet claim to the newer run', async () => {
    claimSheet.mockResolvedValueOnce({ versionId: 'missed', held: false });
    mockSpawnAndAwaitChild.mockRejectedValueOnce(
      new Error('workflow binding missing')
    );

    await makeWorkflow().runBody(makeEvent([sam]), makeStep(), makeScopedDb());

    expect(mockFailSheetClaim).not.toHaveBeenCalled();
    expect(mockGetGenerationChannel).not.toHaveBeenCalled();
  });

  it.each(['sheet', 'voice'] as const)(
    'keeps the optional %s failure distinct after durable cleanup retries are exhausted',
    async (kind) => {
      const errorLog = vi.spyOn(
        getLogger(['openstory', 'workflow', 'character-bible']),
        'error'
      );
      const spawnError = new Error('spawn refused');
      const cleanupError = new Error('database down');
      mockSpawnAndAwaitChild.mockRejectedValueOnce(spawnError);
      const cleanup =
        kind === 'sheet' ? mockFailSheetClaim : markVoiceClaimTerminal;
      cleanup.mockRejectedValueOnce(cleanupError);
      const voice = kind === 'voice';
      const character = voice ? narrator : sam;

      await makeWorkflow().runBody(
        makeEvent([character], {
          generateVoices: voice,
          speakingCharacterIds: [character.characterId],
        }),
        makeStep(),
        makeScopedDb()
      );

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('exhausted retries'),
        {
          stepName: expect.stringMatching(/^fail-character-/),
          err: cleanupError,
        }
      );
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(`Child character-${kind} failed for`),
        { err: spawnError }
      );
    }
  );

  it.each(['cleanup', 'notification'] as const)(
    'retries durable sheet failure actions after a transient %s failure',
    async (action) => {
      const firstError = new Error('failure action unavailable');
      mockSpawnAndAwaitChild.mockRejectedValueOnce(new Error('spawn refused'));
      const failingAction =
        action === 'cleanup' ? mockFailSheetClaim : mockEmit;
      failingAction.mockRejectedValueOnce(firstError);

      const result = await makeWorkflow().runBody(
        makeEvent([sam]),
        makeRetryingStep('fail-character-sheet-0', firstError),
        makeScopedDb()
      );

      expect(mockFailSheetClaim).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(result[0]).toMatchObject({ sheetStatus: 'failed' });
    }
  );

  it.each(
    ENGINE_ABORT_MESSAGES.flatMap((message) =>
      ['sheet claim', 'sheet spawn', 'voice claim', 'voice spawn'].map(
        (stage) => ({ message, stage })
      )
    )
  )('preserves a parent $stage abort: $message', async ({ message, stage }) => {
    const abort = new Error(message);
    if (stage === 'sheet claim') claimSheet.mockRejectedValueOnce(abort);
    else if (stage === 'voice claim')
      createPendingVoiceClaim.mockRejectedValueOnce(abort);
    else mockSpawnAndAwaitChild.mockRejectedValueOnce(abort);
    const voice = stage.startsWith('voice');
    const character = voice ? narrator : sam;

    await expect(
      makeWorkflow().runBody(
        makeEvent([character], {
          generateVoices: voice,
          speakingCharacterIds: [character.characterId],
        }),
        makeStep(),
        makeScopedDb()
      )
    ).rejects.toBe(abort);
    expect(mockFailSheetClaim).not.toHaveBeenCalled();
    expect(markVoiceClaimTerminal).not.toHaveBeenCalled();
    expect(mockGetGenerationChannel).not.toHaveBeenCalled();
  });

  it.each(['cleanup', 'notification'] as const)(
    'propagates a sheet failure %s abort through the settled children',
    async (action) => {
      const abort = new Error(ENGINE_ABORT_MESSAGES[1]);
      mockSpawnAndAwaitChild.mockRejectedValueOnce(new Error('spawn refused'));
      const failingAction =
        action === 'cleanup' ? mockFailSheetClaim : mockEmit;
      failingAction.mockRejectedValueOnce(abort);

      await expect(
        makeWorkflow().runBody(makeEvent([sam]), makeStep(), makeScopedDb())
      ).rejects.toBe(abort);
      expect(mockFailSheetClaim).toHaveBeenCalledTimes(1);
      if (action === 'cleanup')
        expect(mockGetGenerationChannel).not.toHaveBeenCalled();
    }
  );

  it('retries a parent-owned voice cleanup in a durable step', async () => {
    const cleanupError = new Error('database down');
    mockSpawnAndAwaitChild.mockRejectedValueOnce(new Error('spawn refused'));
    markVoiceClaimTerminal.mockRejectedValueOnce(cleanupError);

    await makeWorkflow().runBody(
      makeEvent([narrator], {
        generateVoices: true,
        speakingCharacterIds: ['narrator'],
      }),
      makeRetryingStep('fail-character-voice-narrator', cleanupError),
      makeScopedDb()
    );

    expect(markVoiceClaimTerminal).toHaveBeenCalledTimes(2);
    expect(markVoiceClaimTerminal).toHaveBeenLastCalledWith(
      'husk-1',
      'failed',
      'spawn refused'
    );
    expect(mockFailSheetClaim).not.toHaveBeenCalled();
  });

  it('propagates an engine abort during parent-owned voice cleanup', async () => {
    const abort = new Error(ENGINE_ABORT_MESSAGES[0]);
    mockSpawnAndAwaitChild.mockRejectedValueOnce(new Error('spawn refused'));
    markVoiceClaimTerminal.mockRejectedValueOnce(abort);

    await expect(
      makeWorkflow().runBody(
        makeEvent([narrator], {
          generateVoices: true,
          speakingCharacterIds: ['narrator'],
        }),
        makeStep(),
        makeScopedDb()
      )
    ).rejects.toBe(abort);
    expect(markVoiceClaimTerminal).toHaveBeenCalledTimes(1);
    expect(mockFailSheetClaim).not.toHaveBeenCalled();
    expect(mockGetGenerationChannel).not.toHaveBeenCalled();
  });

  it('stamps voice generating before spawning the voice child (#1715)', async () => {
    mockSpawnAndAwaitChild.mockImplementation(
      async (_step: unknown, opts: { childId: string }) =>
        opts.childId.startsWith('character-voice:')
          ? { voiceId: 'voice-1', voiceDescription: 'Warm alto' }
          : {
              sheetImageUrl: '/r2/characters/sam.png',
              sheetVersionId: 'ver-sam',
            }
    );
    await makeWorkflow().runBody(
      makeEvent([sam], { generateVoices: true, speakingCharacterIds: ['sam'] }),
      makeStep(),
      makeScopedDb()
    );
    expect(createPendingVoiceClaim).toHaveBeenCalledWith(
      expect.any(String),
      'u1',
      {
        activity: {
          sequenceId: 'seq-1',
          summary: 'Started a voice for Sam',
        },
      }
    );
    expect(mockSpawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        childId: expect.stringMatching(/^character-voice:/),
        childPayload: expect.objectContaining({ targetVersionId: 'husk-1' }),
      })
    );
  });

  it('fails the husk if the voice child never starts (#1715)', async () => {
    mockSpawnAndAwaitChild.mockImplementation(
      async (_step: unknown, opts: { childId: string }) => {
        if (opts.childId.startsWith('character-voice:')) {
          throw new Error('workflow binding missing');
        }
        return {
          sheetImageUrl: '/r2/characters/sam.png',
          sheetVersionId: 'ver-sam',
        };
      }
    );
    await makeWorkflow().runBody(
      makeEvent([sam], { generateVoices: true, speakingCharacterIds: ['sam'] }),
      makeStep(),
      makeScopedDb()
    );
    expect(markVoiceClaimTerminal).toHaveBeenCalledWith(
      'husk-1',
      'failed',
      'workflow binding missing'
    );
  });

  it('does not rewrite a voice husk already failed by the child', async () => {
    mockSpawnAndAwaitChild.mockImplementation(
      async (_step: unknown, opts: { childId: string }) => {
        if (opts.childId.startsWith('character-voice:')) {
          throw new Error(
            'Child workflow character-voice:sam failed: Error: provider refused'
          );
        }
        return {
          sheetImageUrl: '/r2/characters/sam.png',
          sheetVersionId: 'ver-sam',
        };
      }
    );

    await makeWorkflow().runBody(
      makeEvent([sam], { generateVoices: true, speakingCharacterIds: ['sam'] }),
      makeStep(),
      makeScopedDb()
    );

    expect(markVoiceClaimTerminal).not.toHaveBeenCalled();
  });

  it('skips spawn when a live husk already has a run id (#1715)', async () => {
    createPendingVoiceClaim.mockResolvedValueOnce({
      version: { id: 'husk-live', workflowRunId: 'run-live' },
      created: false,
    });
    mockSpawnAndAwaitChild.mockImplementation(
      async (_step: unknown, opts: { childId: string }) =>
        opts.childId.startsWith('character-voice:')
          ? { voiceId: 'voice-1', voiceDescription: 'Warm alto' }
          : {
              sheetImageUrl: '/r2/characters/sam.png',
              sheetVersionId: 'ver-sam',
            }
    );
    await makeWorkflow().runBody(
      makeEvent([sam], { generateVoices: true, speakingCharacterIds: ['sam'] }),
      makeStep(),
      makeScopedDb()
    );
    expect(mockSpawnAndAwaitChild).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        childId: expect.stringMatching(/^character-voice:/),
      })
    );
    expect(markVoiceClaimTerminal).not.toHaveBeenCalled();
  });

  it('adopts a zombie husk and fails it if spawn never starts (#1715)', async () => {
    createPendingVoiceClaim.mockResolvedValueOnce({
      version: { id: 'husk-zombie', workflowRunId: null },
      created: false,
    });
    mockSpawnAndAwaitChild.mockImplementation(
      async (_step: unknown, opts: { childId: string }) => {
        if (opts.childId.startsWith('character-voice:')) {
          throw new Error('workflow binding missing');
        }
        return {
          sheetImageUrl: '/r2/characters/sam.png',
          sheetVersionId: 'ver-sam',
        };
      }
    );
    await makeWorkflow().runBody(
      makeEvent([sam], { generateVoices: true, speakingCharacterIds: ['sam'] }),
      makeStep(),
      makeScopedDb()
    );
    expect(mockSpawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        childPayload: expect.objectContaining({
          targetVersionId: 'husk-zombie',
        }),
      })
    );
    expect(markVoiceClaimTerminal).toHaveBeenCalledWith(
      'husk-zombie',
      'failed',
      'workflow binding missing'
    );
  });
});

describe('CharacterBibleWorkflow pipeline sheets are tracked (#1113)', () => {
  it('claims each sheet and stamps the hash a regenerate of the row would compute', async () => {
    const { computeCharacterSheetHashFromDto } =
      await import('./sheet-snapshots');
    const { characterToBible } =
      await import('@/cast/server/bibles-from-scoped');

    await makeWorkflow().runBody(makeEvent([sam]), makeStep(), makeScopedDb());

    const [spawnCall] = mockSpawnAndAwaitChild.mock.calls;
    if (!spawnCall) throw new Error('expected a sheet child');
    // the mocked spawn's second argument
    const { childPayload } = asStub<{
      childPayload: CharacterSheetWorkflowInput;
    }>(spawnCall[1]);
    const [row] = characterCreate.mock.calls[0] ?? [];
    if (!row) throw new Error('expected the character row');

    expect(childPayload.sheetVersionId).toBe(`ver-${row.id}`);
    expect(childPayload.snapshotInputHash).toBeDefined();
    // The claim names what the run was snapshotted from, so it is taken only
    // while that still holds (#1863).
    expect(childPayload).toMatchObject({
      lookId: row.id,
      lookVersionId: `lookver-${row.id}`,
    });
    expect(claimSheet).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({
        lookVersionId: `lookver-${row.id}`,
        bibleVersionId: `bible-${row.id}`,
      }),
      expect.objectContaining({
        markGenerating: false,
        activity: expect.objectContaining({
          sequenceId: 'seq-1',
          summary: expect.stringContaining('Started a sheet for Sam'),
        }),
      })
    );

    // The staleness check hashes the stored row, not the LLM entry: a
    // pipeline sheet must not read "stale" the moment it lands.
    // the insert row plus the read-side sheet fields
    const stored = asStub<Parameters<typeof characterToBible>[0]>({
      ...row,
      lookId: row.id,
      lookName: 'Default',
      looks: [],
      sheetImageUrl: null,
      sheetImagePath: null,
      sheetGeneratedAt: null,
      sheetInputHash: null,
    });
    expect(
      await computeCharacterSheetHashFromDto({
        ...childPayload,
        characterMetadata: characterToBible(stored),
      })
    ).toBe(childPayload.snapshotInputHash);
  });
});
