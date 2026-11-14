import { expect, expectTypeOf, test, vi } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { SceneSplitWorkflowInput } from '@/platform/server/workflow/types';
import { StoryboardContentOwnershipError } from '@/sequences/server/db/storyboard-content-scope';
import { asStub } from '@/test/as-stub';
import { bindSceneSplitContent } from './scene-split-content';

type SplitInput = Pick<
  SceneSplitWorkflowInput,
  'sequenceId' | 'storyboardOwner'
>;
type Content = ReturnType<WorkflowScopedDb['storyboardContent']>;

const SEQUENCE_ID = 'mock-scene-split-sequence';
const OWNER = {
  workflowRunId: 'mock-trusted-storyboard-root',
  workflowClaimId: 'mock-trusted-storyboard-claim',
};
const INPUT: SplitInput = { sequenceId: SEQUENCE_ID, storyboardOwner: OWNER };
const PARENT = {
  bindingName: 'STORYBOARD_WORKFLOW',
  parentInstanceId: 'mock-notify-parent-not-content-id',
  eventType: 'mock-child-complete',
};
const CONTENT_DOMAINS = [
  'sequences',
  'scenes',
  'shots',
  'sceneScriptVersions',
  'shotDialogue',
  'sequenceElements',
  'sequenceEvents',
] as const satisfies readonly (keyof Content)[];

// Explicit method-identity doubles; these tests never construct a database.
function makeShotContentDouble() {
  return {
    bulkUpsert: vi.fn<Content['shots']['bulkUpsert']>(),
    update: vi.fn<Content['shots']['update']>(),
    delete: vi.fn<Content['shots']['delete']>(),
    deleteFromShotNumber: vi.fn<Content['shots']['deleteFromShotNumber']>(),
    deleteByScenesFromOrderIndex:
      vi.fn<Content['shots']['deleteByScenesFromOrderIndex']>(),
  };
}

function makeContentDouble() {
  return {
    sequences: {
      updateTitle: vi.fn<Content['sequences']['updateTitle']>(),
      updateWorkflow: vi.fn<Content['sequences']['updateWorkflow']>(),
    },
    scenes: {
      upsert: vi.fn<Content['scenes']['upsert']>(),
      deleteFromOrderIndex: vi.fn<Content['scenes']['deleteFromOrderIndex']>(),
    },
    shots: makeShotContentDouble(),
    sceneScriptVersions: {
      seedSplitVersions:
        vi.fn<Content['sceneScriptVersions']['seedSplitVersions']>(),
      updateSplitContent:
        vi.fn<Content['sceneScriptVersions']['updateSplitContent']>(),
    },
    shotDialogue: { write: vi.fn<Content['shotDialogue']['write']>() },
    sequenceElements: {
      updateFirstMention:
        vi.fn<Content['sequenceElements']['updateFirstMention']>(),
    },
    sequenceEvents: {
      recordOnce: vi.fn<Content['sequenceEvents']['recordOnce']>(),
    },
  } satisfies Content;
}

function makeExistingDomains() {
  const content = makeContentDouble();
  return {
    sequences: {
      ...content.sequences,
      updateAnalysisDurationMs:
        vi.fn<WorkflowScopedDb['sequences']['updateAnalysisDurationMs']>(),
    },
    scenes: {
      ...content.scenes,
      create: vi.fn<WorkflowScopedDb['scenes']['create']>(),
    },
    shots: {
      ...content.shots,
      create: vi.fn<WorkflowScopedDb['shots']['create']>(),
    },
    sceneScriptVersions: {
      ...content.sceneScriptVersions,
      write: vi.fn<WorkflowScopedDb['sceneScriptVersions']['write']>(),
    },
    shotDialogue: {
      ...content.shotDialogue,
      selectVersion: vi.fn<WorkflowScopedDb['shotDialogue']['selectVersion']>(),
    },
    sequenceElements: {
      ...content.sequenceElements,
      create: vi.fn<WorkflowScopedDb['sequenceElements']['create']>(),
    },
    sequenceEvents: {
      ...content.sequenceEvents,
      record: vi.fn<WorkflowScopedDb['sequenceEvents']['record']>(),
    },
  };
}

function makeFixture() {
  const content = makeContentDouble();
  const domains = makeExistingDomains();
  const storyboardContent = vi.fn<WorkflowScopedDb['storyboardContent']>(
    () => content
  );
  const db = asStub<WorkflowScopedDb>({
    ...domains,
    storyboardContent,
    organizationId: 'mock-organization',
    userId: 'mock-user',
    models: DEFAULT_MODEL_CONFIGURATION,
    credentials: { resolveLlmKey: vi.fn() },
    claims: { frameVariants: { getById: vi.fn() } },
    liveRead: { compliance: { listEnforcementFor: vi.fn() } },
    sequence: vi.fn(),
  });
  return { db, content, domains, storyboardContent };
}

test('keeps the synchronous workflow adapter signature', () => {
  expectTypeOf(bindSceneSplitContent).toEqualTypeOf<
    (db: WorkflowScopedDb, input: SplitInput) => WorkflowScopedDb
  >();
});

test('forwards exactly the trusted sequence, root run and claim', () => {
  const { db, storyboardContent } = makeFixture();
  const input = {
    ...INPUT,
    _parent: PARENT,
    workflowRunId: 'mock-child-run-not-owner',
    workflowClaimId: 'mock-child-claim-not-owner',
  };
  bindSceneSplitContent(db, input);
  expect(storyboardContent).toHaveBeenCalledExactlyOnceWith({
    id: SEQUENCE_ID,
    ...OWNER,
  });
  expect(input.storyboardOwner).toBe(OWNER);
});

test('does not fabricate a claim for a trusted root without one', () => {
  const { db, storyboardContent } = makeFixture();
  bindSceneSplitContent(db, {
    sequenceId: SEQUENCE_ID,
    storyboardOwner: { workflowRunId: OWNER.workflowRunId },
  });
  expect(storyboardContent).toHaveBeenCalledExactlyOnceWith({
    id: SEQUENCE_ID,
    workflowRunId: OWNER.workflowRunId,
  });
});

const STANDALONE_INPUTS = [
  { name: 'neither sequence nor owner', input: {} },
  { name: 'sequence without owner', input: { sequenceId: SEQUENCE_ID } },
  { name: 'owner without sequence', input: { storyboardOwner: OWNER } },
  {
    name: 'empty sequence with owner',
    input: { sequenceId: '', storyboardOwner: OWNER },
  },
] satisfies { name: string; input: SplitInput }[];

test.each(STANDALONE_INPUTS)(
  'preserves standalone identity: $name',
  ({ input }) => {
    const { db, storyboardContent } = makeFixture();
    expect(bindSceneSplitContent(db, input)).toBe(db);
    expect(storyboardContent).not.toHaveBeenCalled();
  }
);

test('notify metadata cannot manufacture an owner', () => {
  const { db, storyboardContent } = makeFixture();
  const input = { sequenceId: SEQUENCE_ID, _parent: PARENT };
  expect(bindSceneSplitContent(db, input)).toBe(db);
  expect(storyboardContent).not.toHaveBeenCalled();
});

test('a parent instance cannot substitute for a missing sequence id', () => {
  const { db, storyboardContent } = makeFixture();
  const input = { storyboardOwner: OWNER, _parent: PARENT };
  expect(bindSceneSplitContent(db, input)).toBe(db);
  expect(storyboardContent).not.toHaveBeenCalled();
});

test.each(CONTENT_DOMAINS)(
  'overlays %s methods and retains its other methods',
  async (domain) => {
    const { db, content, domains } = makeFixture();
    Object.freeze(db);
    Object.freeze(domains[domain]);
    const bound = bindSceneSplitContent(db, INPUT);
    expect(bound).not.toBe(db);
    for (const [name, writer] of Object.entries(content[domain])) {
      const failure = new Error(`Mock ${domain}.${name} write rejected`);
      writer.mockRejectedValue(failure);
      const boundWriter = contentWriter(bound, domain, name);
      await expect(Reflect.apply(boundWriter, undefined, [])).rejects.toBe(
        failure
      );
      expect(writer).toHaveBeenCalledExactlyOnceWith();
    }
    for (const [name, writer] of Object.entries(domains[domain])) {
      if (!(name in content[domain])) {
        expect(Reflect.get(bound[domain], name)).toBe(writer);
      }
    }
    expect(db[domain]).toBe(domains[domain]);
    expect(db[domain]).not.toEqual(bound[domain]);
  }
);

test('retains credentials, model snapshots, claims, live reads and unrelated scope', () => {
  const { db } = makeFixture();
  const bound = bindSceneSplitContent(db, INPUT);
  expect(bound.credentials).toBe(db.credentials);
  expect(bound.models).toBe(db.models);
  expect(bound.claims).toBe(db.claims);
  expect(bound.liveRead).toBe(db.liveRead);
  expect(bound.sequence).toBe(db.sequence);
  expect(bound.storyboardContent).toBe(db.storyboardContent);
  expect(bound.organizationId).toBe(db.organizationId);
  expect(bound.userId).toBe(db.userId);
});

test('propagates a binding failure', () => {
  const { db, storyboardContent } = makeFixture();
  const failure = new Error('Mock storyboard binding rejected');
  storyboardContent.mockImplementation(() => {
    throw failure;
  });
  expect(() => bindSceneSplitContent(db, INPUT)).toThrow(failure);
});

test('propagates an owned write rejection without an unguarded fallback', async () => {
  const { db, content, domains } = makeFixture();
  const failure = new Error('Mock storyboard lost content ownership');
  content.sequences.updateTitle.mockRejectedValue(failure);
  const bound = bindSceneSplitContent(db, INPUT);
  await expect(
    bound.sequences.updateTitle(SEQUENCE_ID, 'Mock title')
  ).rejects.toBe(failure);
  expect(content.sequences.updateTitle).toHaveBeenCalledExactlyOnceWith(
    SEQUENCE_ID,
    'Mock title'
  );
  expect(domains.sequences.updateTitle).not.toHaveBeenCalled();
});

function contentWriter(
  db: WorkflowScopedDb,
  domain: keyof Content,
  name: string
) {
  const writer: unknown = Reflect.get(db[domain], name);
  if (typeof writer !== 'function')
    throw new Error(`Missing ${domain}.${name}`);
  return writer;
}

// NonRetryableError uses the explicit local Cloudflare class in vitest.config.ts.
test.each(CONTENT_DOMAINS)(
  'propagates ownership loss from %s as a non-retryable workflow error',
  async (domain) => {
    const { db, content, domains } = makeFixture();
    const failure = new StoryboardContentOwnershipError();
    const bound = bindSceneSplitContent(db, INPUT);
    for (const [name, writer] of Object.entries(content[domain])) {
      writer.mockRejectedValue(failure);
      const boundWriter = contentWriter(bound, domain, name);
      const pending: unknown = Reflect.apply(boundWriter, undefined, []);
      await expect(pending).rejects.toBeInstanceOf(NonRetryableError);
      await expect(pending).rejects.toMatchObject({
        name: 'StoryboardContentOwnershipError',
        message: failure.message,
        cause: failure,
      });
      expect(writer).toHaveBeenCalledExactlyOnceWith();
      expect(Reflect.get(domains[domain], name)).not.toHaveBeenCalled();
    }
  }
);

test('preserves a serialized ownership error from the event writer as the cause', async () => {
  const { db, content, domains } = makeFixture();
  const failure = {
    name: 'StoryboardContentOwnershipError',
    message: 'Mock serialized storyboard ownership loss',
  };
  content.sequenceEvents.recordOnce.mockRejectedValue(failure);
  const bound = bindSceneSplitContent(db, INPUT);
  const event = {
    id: 'mock-owned-event',
    sequenceId: SEQUENCE_ID,
    actorId: 'mock-user',
    kind: 'mock-event',
    targetType: 'sequence' as const,
    targetId: SEQUENCE_ID,
  };
  const pending = bound.sequenceEvents.recordOnce(event);
  await expect(pending).rejects.toBeInstanceOf(NonRetryableError);
  await expect(pending).rejects.toMatchObject({ ...failure, cause: failure });
  expect(content.sequenceEvents.recordOnce).toHaveBeenCalledExactlyOnceWith(
    event
  );
  expect(domains.sequenceEvents.recordOnce).not.toHaveBeenCalled();
});
