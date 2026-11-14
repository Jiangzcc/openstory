import { and, eq, exists, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { sequences, storyboardLaunches } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { ValidationError } from '@/platform/errors';
import type { PreparedWorkflowRun } from '@/platform/server/workflow/prepared-trigger';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { ContinueSettings } from '@/sequences/continue-settings';
import { generationStopChangedSummary } from '@/sequences/model-label';
import {
  buildEventInsertIfPresent,
  SETTINGS_CHANGED_EVENT,
} from './sequence-events';

const MILLISECONDS_PER_SECOND = 1000;
const PROCESSING_STATUS = 'processing';
const START_EVENT = 'storyboard.started';
type Slot = { id: string; workflowRunId: string };
type LaunchClaim = {
  id: string;
  expectedRunId: string | null;
  claimId: string;
  activity: { summary: string } | null;
  launch: PreparedWorkflowRun<StoryboardWorkflowInput>;
  settings?: ContinueSettings;
};

function sequenceOwner(organizationId: string, id: string, runId: string) {
  return and(
    eq(sequences.id, id),
    eq(sequences.organizationId, organizationId),
    eq(sequences.workflowRunId, runId)
  );
}

function matchesContinueSettings(params: LaunchClaim) {
  const {
    settings,
    launch: { body },
  } = params;
  return (
    !settings ||
    (body.stopAt === settings.generationStopAt &&
      body.referenceOnly === !settings.generateStartFrames &&
      body.generateVoices === settings.generateVoices &&
      body.draftMotion === settings.draftMotion)
  );
}

function availableSlot(organizationId: string, params: LaunchClaim) {
  return and(
    eq(sequences.id, params.id),
    eq(sequences.organizationId, organizationId),
    params.expectedRunId === null
      ? isNull(sequences.workflowRunId)
      : eq(sequences.workflowRunId, params.expectedRunId)
  );
}

function assertLaunchOwner(
  organizationId: string,
  userId: string,
  params: LaunchClaim
) {
  const { launch } = params;
  if (
    launch.triggerPath !== '/storyboard' ||
    launch.workflowRunId !== params.claimId ||
    launch.body.sequenceId !== params.id ||
    launch.body.organizationId !== organizationId ||
    launch.body.userId !== userId ||
    !matchesContinueSettings(params) ||
    (launch.body.workflowClaimId !== undefined &&
      launch.body.workflowClaimId !== params.claimId)
  ) {
    throw new ValidationError(
      'Storyboard launch does not match its scoped owner'
    );
  }
}

function buildSlotClaim(
  db: Database,
  organizationId: string,
  params: LaunchClaim
) {
  return db
    .update(sequences)
    .set({
      ...params.settings,
      workflowRunId: params.claimId,
      status: PROCESSING_STATUS,
      statusError: null,
      updatedAt: new Date(),
    })
    .where(availableSlot(organizationId, params))
    .returning({ id: sequences.id });
}

function buildLaunchInsert(
  db: Database,
  organizationId: string,
  params: LaunchClaim
) {
  return db.insert(storyboardLaunches).select(
    db
      .select({
        id: sql<string>`${generateId()}`.as('id'),
        organizationId: sequences.organizationId,
        sequenceId: sequences.id,
        workflowRunId: sql<string>`${params.launch.workflowRunId}`.as(
          'workflow_run_id'
        ),
        prepared: sql`${JSON.stringify(params.launch)}`.as('prepared'),
        submittedAt: sql`null`.as('submitted_at'),
        lastAttemptAt: sql`null`.as('last_attempt_at'),
        createdAt: sql`${Math.floor(Date.now() / MILLISECONDS_PER_SECOND)}`.as(
          'created_at'
        ),
      })
      .from(sequences)
      .where(sequenceOwner(organizationId, params.id, params.claimId))
      .limit(1)
  );
}

function buildContinueSettingsEvent(
  db: Database,
  organizationId: string,
  userId: string,
  params: LaunchClaim,
  settings: ContinueSettings
) {
  const stopAt = settings.generationStopAt;
  return buildEventInsertIfPresent(
    db,
    {
      id: generateId(),
      sequenceId: params.id,
      actorId: userId,
      kind: SETTINGS_CHANGED_EVENT,
      targetType: 'sequence',
      targetId: params.id,
      summary: generationStopChangedSummary(stopAt),
    },
    sequences,
    and(
      availableSlot(organizationId, params),
      or(
        isNull(sequences.generationStopAt),
        ne(sequences.generationStopAt, stopAt)
      )
    ),
    sql`json_object(
      'fields', json_array('generationStopAt'),
      'changes', json_array(json_object(
        'field', 'generationStopAt',
        'from', ${sequences.generationStopAt},
        'to', ${stopAt}
      ))
    )`
  );
}

function buildStartActivity(
  db: Database,
  organizationId: string,
  userId: string,
  params: LaunchClaim
) {
  return params.activity
    ? [
        buildEventInsertIfPresent(
          db,
          {
            id: generateId(),
            sequenceId: params.id,
            actorId: userId,
            kind: START_EVENT,
            targetType: 'sequence',
            targetId: params.id,
            summary: params.activity.summary,
          },
          sequences,
          sequenceOwner(organizationId, params.id, params.claimId)
        ),
      ]
    : [];
}

async function claimSlot(
  db: Database,
  organizationId: string,
  userId: string,
  params: LaunchClaim
) {
  assertLaunchOwner(organizationId, userId, params);
  const settingsEvent = params.settings
    ? buildContinueSettingsEvent(
        db,
        organizationId,
        userId,
        params,
        params.settings
      )
    : null;
  const activity = buildStartActivity(db, organizationId, userId, params);
  const mutations = [
    buildSlotClaim(db, organizationId, params),
    buildLaunchInsert(db, organizationId, params),
    ...activity,
  ] as const;
  if (settingsEvent) {
    const [, claimed] = await db.batch([settingsEvent, ...mutations]);
    return claimed.length > 0;
  }
  const [claimed] = await db.batch(mutations);
  return claimed.length > 0;
}

async function getWorkflowLaunch(
  db: Database,
  organizationId: string,
  params: Slot
) {
  const [launch] = await db
    .select({
      id: storyboardLaunches.id,
      workflowRunId: storyboardLaunches.workflowRunId,
      prepared: storyboardLaunches.prepared,
      submittedAt: storyboardLaunches.submittedAt,
    })
    .from(storyboardLaunches)
    .innerJoin(
      sequences,
      and(
        eq(sequences.id, storyboardLaunches.sequenceId),
        eq(sequences.organizationId, storyboardLaunches.organizationId),
        eq(sequences.workflowRunId, storyboardLaunches.workflowRunId)
      )
    )
    .where(
      and(
        eq(storyboardLaunches.sequenceId, params.id),
        eq(storyboardLaunches.organizationId, organizationId),
        eq(storyboardLaunches.workflowRunId, params.workflowRunId)
      )
    )
    .limit(1);
  return launch;
}

function buildAcknowledgment(
  db: Database,
  organizationId: string,
  params: Slot
) {
  return db
    .update(storyboardLaunches)
    .set({ submittedAt: new Date() })
    .where(
      and(
        eq(storyboardLaunches.sequenceId, params.id),
        eq(storyboardLaunches.organizationId, organizationId),
        eq(storyboardLaunches.workflowRunId, params.workflowRunId),
        isNull(storyboardLaunches.submittedAt),
        exists(
          db
            .select({ id: sequences.id })
            .from(sequences)
            .where(
              sequenceOwner(organizationId, params.id, params.workflowRunId)
            )
        )
      )
    );
}

async function publishWorkflowInstance(
  db: Database,
  organizationId: string,
  params: Slot & { claimId: string }
) {
  const [published] = await db.batch([
    db
      .update(sequences)
      .set({ workflowRunId: params.workflowRunId, updatedAt: new Date() })
      .where(sequenceOwner(organizationId, params.id, params.claimId))
      .returning({ id: sequences.id }),
    buildAcknowledgment(db, organizationId, params),
  ]);
  return published.length > 0;
}

export function createStoryboardLaunchMethods(
  db: Database,
  organizationId: string,
  userId: string
) {
  return {
    claimWorkflowSlot: (params: LaunchClaim) =>
      claimSlot(db, organizationId, userId, params),
    getWorkflowLaunch: (params: Slot) =>
      getWorkflowLaunch(db, organizationId, params),
    publishWorkflowInstance: (params: Slot & { claimId: string }) =>
      publishWorkflowInstance(db, organizationId, params),
  };
}
