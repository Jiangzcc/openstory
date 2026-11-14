import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { LocationSheetWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import { locationChannelId } from '@/cast/cast-channel';

const ENGINE_ABORT_MESSAGES = [
  'Aborting engine: Grace period complete',
  'Durable Object reset because its code was updated',
] as const;

const mockFailReferenceClaim = vi.fn();
const mockEmit = vi.fn();
const mockGetGenerationChannel = vi.fn();

vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: mockGetGenerationChannel,
}));

const { LocationSheetWorkflow } = await import('./location-sheet-workflow');

class Probe extends LocationSheetWorkflow {
  failBody(
    event: Readonly<WorkflowEvent<LocationSheetWorkflowInput>>,
    error: string,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error, scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeEvent(
  payload: Record<string, unknown> = {}
): Readonly<WorkflowEvent<LocationSheetWorkflowInput>> {
  return asStub({
    instanceId: 'location-sheet-run',
    payload: {
      locationDbId: 'location-1',
      locationName: 'Diner',
      organizationId: 'organization-1',
      referenceVersionId: 'version-1',
      sequenceId: 'sequence-1',
      ...payload,
    },
  });
}

function makeScopedDb(): WorkflowScopedDb {
  return asStub({
    locations: { failReferenceClaim: mockFailReferenceClaim },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFailReferenceClaim.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue(undefined);
  mockGetGenerationChannel.mockReturnValue({ emit: mockEmit });
});

describe('LocationSheetWorkflow failure ownership', () => {
  it('clears its claim and emits failure on the sequence channel', async () => {
    await makeWorkflow().failBody(
      makeEvent(),
      'provider failed',
      makeScopedDb()
    );

    expect(mockFailReferenceClaim).toHaveBeenCalledWith(
      'location-1',
      'version-1',
      'provider failed'
    );
    expect(mockGetGenerationChannel).toHaveBeenCalledWith(
      locationChannelId('sequence-1', 'location-1')
    );
    expect(mockEmit).toHaveBeenCalledWith(
      'generation.location-sheet:progress',
      {
        locationId: 'location-1',
        status: 'failed',
        error: 'provider failed',
      }
    );
  });

  it('clears a legacy claimless run and emits on the location channel', async () => {
    await makeWorkflow().failBody(
      makeEvent({ sequenceId: null, referenceVersionId: undefined }),
      'legacy failed',
      makeScopedDb()
    );

    expect(mockFailReferenceClaim).toHaveBeenCalledWith(
      'location-1',
      null,
      'legacy failed'
    );
    expect(mockGetGenerationChannel).toHaveBeenCalledWith(
      locationChannelId(null, 'location-1')
    );
    expect(mockEmit).toHaveBeenCalledWith(
      'generation.location-sheet:progress',
      expect.objectContaining({ status: 'failed', error: 'legacy failed' })
    );
  });

  it('keeps claim cleanup when the failure event cannot be emitted', async () => {
    mockEmit.mockRejectedValueOnce(new Error('realtime unavailable'));

    await expect(
      makeWorkflow().failBody(makeEvent(), 'provider failed', makeScopedDb())
    ).resolves.toBeUndefined();

    expect(mockFailReferenceClaim).toHaveBeenCalledWith(
      'location-1',
      'version-1',
      'provider failed'
    );
  });

  it('still emits failure when claim cleanup cannot be written', async () => {
    mockFailReferenceClaim.mockRejectedValueOnce(new Error('database down'));

    await expect(
      makeWorkflow().failBody(makeEvent(), 'provider failed', makeScopedDb())
    ).rejects.toThrow('database down');

    expect(mockEmit).toHaveBeenCalledWith(
      'generation.location-sheet:progress',
      expect.objectContaining({ status: 'failed', error: 'provider failed' })
    );
  });
  it('rejects with the cleanup error when both failure actions fail', async () => {
    const cleanupError = new Error('database down');
    mockFailReferenceClaim.mockRejectedValueOnce(cleanupError);
    mockEmit.mockRejectedValueOnce(new Error('realtime unavailable'));

    await expect(
      makeWorkflow().failBody(makeEvent(), 'provider failed', makeScopedDb())
    ).rejects.toBe(cleanupError);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it.each(ENGINE_ABORT_MESSAGES)(
    'stops before notification when cleanup aborts: %s',
    async (message) => {
      const abort = new Error(message);
      mockFailReferenceClaim.mockRejectedValueOnce(abort);

      await expect(
        makeWorkflow().failBody(makeEvent(), 'provider failed', makeScopedDb())
      ).rejects.toBe(abort);
      expect(mockGetGenerationChannel).not.toHaveBeenCalled();
    }
  );

  it('propagates a notification abort over an earlier cleanup error', async () => {
    const abort = new Error(ENGINE_ABORT_MESSAGES[0]);
    mockFailReferenceClaim.mockRejectedValueOnce(new Error('database down'));
    mockEmit.mockRejectedValueOnce(abort);

    await expect(
      makeWorkflow().failBody(makeEvent(), 'provider failed', makeScopedDb())
    ).rejects.toBe(abort);
    expect(mockFailReferenceClaim).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});
