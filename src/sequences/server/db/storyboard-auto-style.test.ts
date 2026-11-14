import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { placeholderAutoStyleDraft } from '@/look/auto-style';
import { parseStyleConfig } from '@/look/style-config';
import { ValidationError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { styles } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { StoryboardContentOwnershipError } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';
import {
  FIXTURE_DATE,
  ULID_PATTERN,
  seedSpace,
} from './storyboard-content-ownership.test.fixture';
import {
  COUNT,
  DRAFT,
  MOMENT,
  MUTATIONS,
  REPLACEMENT_RUN,
  ROOT_LOSSES,
  SOURCE,
  SQL_FAULT,
  SQL_TARGET,
  autoStyleSnapshot,
  expectSqlFailure,
  failAutoStyleSql,
  failureFrom,
  interceptAutoStyleSql,
  seedAutoStyleGraph,
  sequenceFor,
  setRoot,
  styleFor,
  versionsFor,
} from './storyboard-auto-style.test.fixture';
import type { Graph } from './storyboard-auto-style.test.fixture';

// Migrated Node SQLite behind D1; no Workerd/replay/provider acceptance is claimed.
let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedAutoStyleGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT.trigger));
});

function unbound(organizationId = graph.organizationId) {
  return createScopedDb(organizationId, graph.userId);
}
function owner(overrides: Partial<StoryboardOwner> = {}): StoryboardOwner {
  return {
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
    ...overrides,
  };
}
function bound(overrides: Partial<StoryboardOwner> = {}) {
  return unbound().storyboardAutoStyle(owner(overrides));
}
function generate(surface = bound(), target = graph) {
  return surface.styles.setGeneratedForSequence({
    sequenceId: target.sequenceId,
    styleId: target.styleId,
    draft: DRAFT,
  });
}
function snapshot(surface = bound(), target = graph) {
  return surface.sequences.snapshotAutoStyle({
    id: target.sequenceId,
    styleId: target.styleId,
  });
}
function pickLibrary() {
  return unbound().sequences.update({
    id: graph.sequenceId,
    styleId: graph.libraryStyleId,
  });
}
function replaceRoot() {
  return setRoot(db, graph, { workflowRunId: REPLACEMENT_RUN });
}

it.each(MUTATIONS)(
  'allows $name for its active processing root',
  async ({ write }) => {
    const before = await autoStyleSnapshot(db);
    expect(await write(bound(), graph)).toBe(true);
    expect(await autoStyleSnapshot(db)).not.toEqual(before);
  }
);

it('exposes both writes through the actual WorkflowScopedDb adapter', async () => {
  const surface = toWorkflowScopedDb(unbound()).storyboardAutoStyle(owner());
  expect(await generate(surface)).toBe(true);
  expect(await snapshot(surface)).toBe(true);
  expect((await versionsFor(db, graph)).map((row) => row.config)).toEqual([
    DRAFT.config,
  ]);
});

it.each(MUTATIONS)(
  'allows $name through an explicitly trusted raw claim',
  async ({ write }) => {
    await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    expect(
      await write(bound({ workflowClaimId: graph.rawClaimId }), graph)
    ).toBe(true);
  }
);

it.each(MUTATIONS)(
  'does not infer the raw claim for $name from the instance prefix',
  async ({ write }) => {
    await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    const before = await autoStyleSnapshot(db);
    await expect(write(bound(), graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await autoStyleSnapshot(db)).toEqual(before);
  }
);

it.each(MUTATIONS)(
  'rejects an unrelated explicit claim for $name',
  async ({ write }) => {
    await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    const before = await autoStyleSnapshot(db);
    await expect(
      write(bound({ workflowClaimId: generateId() }), graph)
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(await autoStyleSnapshot(db)).toEqual(before);
  }
);

it.each(MUTATIONS)(
  'rejects $name in a foreign organization scope',
  async ({ write }) => {
    const space = await seedSpace(db);
    const surface = unbound(space.organizationId).storyboardAutoStyle(owner());
    const before = await autoStyleSnapshot(db);
    await expect(write(surface, graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await autoStyleSnapshot(db)).toEqual(before);
  }
);

const WRONG_OWNERS = [
  { name: 'missing sequence', change: () => ({ id: generateId() }) },
  { name: 'wrong root', change: () => ({ workflowRunId: REPLACEMENT_RUN }) },
] as const;
describe.each(WRONG_OWNERS)('$name', ({ change }) => {
  it.each(MUTATIONS)('rejects $name without any writes', async ({ write }) => {
    const before = await autoStyleSnapshot(db);
    await expect(write(bound(change()), graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await autoStyleSnapshot(db)).toEqual(before);
  });
});

describe.each(ROOT_LOSSES)('$name', ({ state }) => {
  it.each(MUTATIONS)('rejects $name before writing', async ({ write }) => {
    const surface = bound();
    await setRoot(db, graph, state);
    const before = await autoStyleSnapshot(db);
    await expect(write(surface, graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await autoStyleSnapshot(db)).toEqual(before);
  });
});

const TARGET_SCOPES = ['same organization', 'foreign organization'] as const;
describe.each(TARGET_SCOPES)('%s target', (scope) => {
  it.each(MUTATIONS)(
    'cannot change $name outside the bound sequence',
    async ({ write }) => {
      const space =
        scope === 'same organization'
          ? {
              organizationId: graph.organizationId,
              styleId: graph.libraryStyleId,
            }
          : await seedSpace(db);
      const target = await seedAutoStyleGraph(db, space);
      const before = await autoStyleSnapshot(db);
      expect(await write(bound(), target)).toBe(false);
      expect(await autoStyleSnapshot(db)).toEqual(before);
    }
  );
});

const WRITE_BOUNDARIES = [
  { name: 'style UPDATE', match: SQL_TARGET.style, write: generate },
  {
    name: 'version INSERT in snapshot batch',
    match: SQL_TARGET.version,
    write: snapshot,
  },
  {
    name: 'pointer UPDATE in snapshot batch',
    match: SQL_TARGET.pointer,
    write: snapshot,
  },
] as const;
describe.each(ROOT_LOSSES)('$name after successful precheck', ({ state }) => {
  it.each(WRITE_BOUNDARIES)(
    'fences $name in actual SQL',
    async ({ match, write }) => {
      const surface = bound();
      const timing = interceptAutoStyleSql(db, {
        match,
        moment: MOMENT.before,
        change: () => setRoot(db, graph, state),
      });
      await expect(write(surface)).rejects.toBeInstanceOf(
        StoryboardContentOwnershipError
      );
      await timing.assertUnchanged();
      expect(timing.state.matchedSql).toMatch(match);
    }
  );
});

it.each(MUTATIONS)(
  'also fences $name when its trusted claim is replaced after precheck',
  async ({ match, write }) => {
    await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    const surface = bound({ workflowClaimId: graph.rawClaimId });
    const timing = interceptAutoStyleSql(db, {
      match,
      moment: MOMENT.before,
      change: replaceRoot,
    });
    await expect(write(surface, graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    await timing.assertUnchanged();
  }
);

it('keeps an earlier successful style UPDATE when ownership is lost before snapshot', async () => {
  const surface = bound();
  expect(await generate(surface)).toBe(true);
  await replaceRoot();
  const before = await autoStyleSnapshot(db);
  await expect(snapshot(surface)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  expect(await autoStyleSnapshot(db)).toEqual(before);
  expect((await styleFor(db, graph)).config).toEqual(DRAFT.config);
  expect(await versionsFor(db, graph)).toHaveLength(COUNT.none);
});

const MODES = ['bound', 'ordinary'] as const;
type Mode = (typeof MODES)[number];
function surfaceFor(mode: Mode) {
  return mode === 'bound' ? bound() : unbound();
}

it.each(MODES)(
  '%s refuses style promotion before setGeneratedForSequence',
  async (mode) => {
    await db
      .update(styles)
      .set({ sequenceId: null })
      .where(eq(styles.id, graph.styleId));
    const before = await autoStyleSnapshot(db);
    expect(await generate(surfaceFor(mode))).toBe(false);
    expect(await autoStyleSnapshot(db)).toEqual(before);
  }
);

it('refuses a promotion racing the style UPDATE after successful precheck', async () => {
  const timing = interceptAutoStyleSql(db, {
    match: SQL_TARGET.style,
    moment: MOMENT.before,
    change: () =>
      db
        .update(styles)
        .set({ sequenceId: null })
        .where(eq(styles.id, graph.styleId)),
  });
  expect(await generate()).toBe(false);
  await timing.assertUnchanged();
});

it.each(MODES)(
  '%s snapshots a still-selected style even after promotion',
  async (mode) => {
    await db
      .update(styles)
      .set({ sequenceId: null })
      .where(eq(styles.id, graph.styleId));
    expect(await snapshot(surfaceFor(mode))).toBe(true);
    expect((await versionsFor(db, graph)).map((row) => row.styleId)).toEqual([
      graph.styleId,
    ]);
  }
);

it.each(MODES)(
  '%s returns false after a library style was picked before snapshot',
  async (mode) => {
    await pickLibrary();
    const before = await autoStyleSnapshot(db);
    expect(await snapshot(surfaceFor(mode))).toBe(false);
    expect(await autoStyleSnapshot(db)).toEqual(before);
  }
);

it.each(MODES)(
  '%s retains historical snapshot but preserves a library pick between pre-read and batch',
  async (mode) => {
    const timing = interceptAutoStyleSql(db, {
      match: SQL_TARGET.pointer,
      moment: MOMENT.before,
      change: pickLibrary,
    });
    expect(await snapshot(surfaceFor(mode))).toBe(false);
    expect(timing.state.successfulPrecheck).toBe(true);
    expect(timing.state.fired).toBe(true);
    const after = await autoStyleSnapshot(db);
    const [history] = (await versionsFor(db, graph)).filter(
      (row) => row.source === SOURCE.derived
    );
    expect(history).toMatchObject({
      styleId: graph.styleId,
      config: placeholderAutoStyleDraft().config,
    });
    expect((await sequenceFor(db, graph)).selectedStyleVersionId).not.toBe(
      history?.id
    );
    expect({
      ...after,
      versions: after.versions.filter((row) => row.id !== history?.id),
    }).toEqual(timing.state.expected);
  }
);

it.each(MODES)(
  '%s still updates its orphaned bound style after a library pick',
  async (mode) => {
    await pickLibrary();
    const before = await autoStyleSnapshot(db);
    expect(await generate(surfaceFor(mode))).toBe(true);
    const after = await autoStyleSnapshot(db);
    expect(after.sequences).toEqual(before.sequences);
    expect(after.versions).toEqual(before.versions);
    expect((await styleFor(db, graph)).config).toEqual(DRAFT.config);
  }
);

const UNAVAILABLE_STYLES = [
  'foreign organization',
  'another sequence',
  'missing',
] as const;
async function unavailableStyle(kind: (typeof UNAVAILABLE_STYLES)[number]) {
  if (kind === 'missing') return generateId();
  const space =
    kind === 'another sequence'
      ? { organizationId: graph.organizationId, styleId: graph.libraryStyleId }
      : await seedSpace(db);
  return (await seedAutoStyleGraph(db, space)).styleId;
}
describe.each(UNAVAILABLE_STYLES)('%s style', (kind) => {
  it.each(MODES)(
    '%s cannot update it through the owned sequence',
    async (mode) => {
      const target = { ...graph, styleId: await unavailableStyle(kind) };
      const before = await autoStyleSnapshot(db);
      expect(await generate(surfaceFor(mode), target)).toBe(false);
      expect(await autoStyleSnapshot(db)).toEqual(before);
    }
  );
  it.each(MODES)('%s preserves the original snapshot refusal', async (mode) => {
    const target = { ...graph, styleId: await unavailableStyle(kind) };
    const before = await autoStyleSnapshot(db);
    const result = snapshot(surfaceFor(mode), target);
    if (kind === 'missing')
      await expect(result).rejects.toBeInstanceOf(ValidationError);
    else expect(await result).toBe(false);
    expect(await autoStyleSnapshot(db)).toEqual(before);
  });
});

const NO_OPS = [
  'promoted update',
  'missing update',
  'changed selection',
  'missing sequence',
] as const;
async function prepareNoOp(kind: (typeof NO_OPS)[number]) {
  if (kind === 'promoted update')
    await db
      .update(styles)
      .set({ sequenceId: null })
      .where(eq(styles.id, graph.styleId));
  if (kind === 'changed selection') await pickLibrary();
  const target = { ...graph };
  if (kind === 'missing update') target.styleId = generateId();
  if (kind === 'missing sequence') target.sequenceId = generateId();
  const isUpdate = kind === 'promoted update' || kind === 'missing update';
  return {
    target,
    write: isUpdate ? generate : snapshot,
    match: isUpdate ? SQL_TARGET.style : SQL_TARGET.selection,
  };
}
it.each(NO_OPS)('rechecks ownership after the real no-op: %s', async (kind) => {
  const { target, write, match } = await prepareNoOp(kind);
  const timing = interceptAutoStyleSql(db, {
    match,
    moment: MOMENT.after,
    change: replaceRoot,
  });
  await expect(write(bound(), target)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  await timing.assertUnchanged();
});

it('rechecks ownership when a missing style read fails after a valid precheck', async () => {
  const target = { ...graph, styleId: generateId() };
  const timing = interceptAutoStyleSql(db, {
    match: SQL_TARGET.config,
    moment: MOMENT.after,
    change: replaceRoot,
  });
  const error = await failureFrom(snapshot(bound(), target));
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error).toHaveProperty('cause', expect.any(ValidationError));
  await timing.assertUnchanged();
});

describe.each(ROOT_LOSSES)('ordinary methods with $name', ({ state }) => {
  it.each(MUTATIONS)('keeps ownerless $name usable', async ({ write }) => {
    await setRoot(db, graph, state);
    expect(await write(unbound(), graph)).toBe(true);
  });
});

const FAULTS = [
  {
    name: 'version INSERT',
    table: 'sequence_style_versions',
    operation: 'INSERT',
  },
  { name: 'pointer UPDATE', table: 'sequences', operation: 'UPDATE' },
] as const;
describe.each(MODES)('%s SQL failure', (mode) => {
  it.each(FAULTS)(
    'rolls back snapshot version and pointer on $name failure',
    async ({ table, operation }) => {
      expect(await snapshot(surfaceFor(mode))).toBe(true);
      expect(await generate(surfaceFor(mode))).toBe(true);
      const before = await autoStyleSnapshot(db);
      await failAutoStyleSql(db, table, operation);
      const error = await failureFrom(snapshot(surfaceFor(mode)));
      expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
      expectSqlFailure(error);
      expect(await autoStyleSnapshot(db)).toEqual(before);
    }
  );
  it('preserves the original style UPDATE error and data', async () => {
    const before = await autoStyleSnapshot(db);
    await failAutoStyleSql(db, 'styles', 'UPDATE');
    const error = await failureFrom(generate(surfaceFor(mode)));
    expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
    expectSqlFailure(error);
    expect(await autoStyleSnapshot(db)).toEqual(before);
  });
});

it('stores schema-encoded config/tags, dates, booleans and version defaults', async () => {
  expect(await generate()).toBe(true);
  const style = await styleFor(db, graph);
  expect(style).toMatchObject({
    ...DRAFT,
    isPublic: false,
    isTemplate: false,
    sequenceId: graph.sequenceId,
  });
  expect(style.createdAt).toEqual(FIXTURE_DATE);
  expect(style.updatedAt).toBeInstanceOf(Date);
  expect(style.updatedAt).not.toEqual(FIXTURE_DATE);
  expect(await snapshot()).toBe(true);
  const [version] = await versionsFor(db, graph);
  expect(version).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    sequenceId: graph.sequenceId,
    styleId: graph.styleId,
    config: DRAFT.config,
    source: SOURCE.derived,
    createdBy: null,
  });
  expect(version?.createdAt).toBeInstanceOf(Date);
  expect((await sequenceFor(db, graph)).selectedStyleVersionId).toBe(
    version?.id
  );
  expect((await sequenceFor(db, graph)).legacyStyleConfig).toBeNull();
  const raw = await autoStyleSnapshot(db);
  expect(raw.styles.find((row) => row.id === graph.styleId)).toMatchObject({
    config: JSON.stringify(DRAFT.config),
    tags: JSON.stringify(DRAFT.tags),
    is_public: COUNT.none,
    is_template: COUNT.none,
  });
  expect(raw.versions.find((row) => row.id === version?.id)).toMatchObject({
    config: JSON.stringify(DRAFT.config),
    created_at: expect.any(Number),
    created_by: null,
  });
});

it('keeps null draft fields and empty arrays encoded without inventing defaults', async () => {
  const draft = { ...DRAFT, description: null, category: null, tags: [] };
  expect(
    await bound().styles.setGeneratedForSequence({
      sequenceId: graph.sequenceId,
      styleId: graph.styleId,
      draft,
    })
  ).toBe(true);
  expect(await styleFor(db, graph)).toMatchObject(draft);
});

it.each(MODES)(
  '%s appends repeated snapshots and leaves earlier recipes immutable',
  async (mode) => {
    const surface = surfaceFor(mode);
    expect(await snapshot(surface)).toBe(true);
    const [first] = await versionsFor(db, graph);
    expect(await generate(surface)).toBe(true);
    expect(await snapshot(surface)).toBe(true);
    const versions = await versionsFor(db, graph);
    expect(versions).toHaveLength(COUNT.two);
    expect(versions.find((row) => row.id === first?.id)?.config).toEqual(
      placeholderAutoStyleDraft().config
    );
    const selected = (await sequenceFor(db, graph)).selectedStyleVersionId;
    expect(selected).not.toBe(first?.id);
    expect(versions.find((row) => row.id === selected)?.config).toEqual(
      DRAFT.config
    );
  }
);

it.each(MODES)(
  '%s snapshots a legacy style through the existing v1 parser',
  async (mode) => {
    const legacy = {
      mood: DRAFT.config.look.mood,
      artStyle: DRAFT.config.look.artStyle,
      lighting: DRAFT.config.look.lighting,
      colorPalette: DRAFT.config.look.colorPalette,
      cameraWork: DRAFT.config.motion.camera,
      referenceFilms: DRAFT.config.references,
      colorGrading: DRAFT.config.look.colorGrading,
    };
    await db
      .update(styles)
      .set({ config: legacy })
      .where(eq(styles.id, graph.styleId));
    expect(await snapshot(surfaceFor(mode))).toBe(true);
    expect((await versionsFor(db, graph)).map((row) => row.config)).toEqual([
      parseStyleConfig(legacy),
    ]);
  }
);

it.each(MODES)(
  '%s can snapshot an explicitly selected public style owned by another organization',
  async (mode) => {
    const other = await seedSpace(db);
    await db
      .update(styles)
      .set({ isPublic: true })
      .where(eq(styles.id, other.styleId));
    await unbound().sequences.update({
      id: graph.sequenceId,
      styleId: other.styleId,
    });
    expect(
      await snapshot(surfaceFor(mode), { ...graph, styleId: other.styleId })
    ).toBe(true);
    expect(
      (await versionsFor(db, graph)).map((row) => row.source).sort()
    ).toEqual([SOURCE.derived, SOURCE.switched].sort());
  }
);
