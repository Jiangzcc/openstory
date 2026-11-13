import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';

const copyFile = vi.fn(async () => undefined);
const triggerWorkflow = vi.fn(async () => 'run-1');
vi.doMock('#storage', () => ({ copyFile }));
vi.doMock('@/platform/server/workflow/client', () => ({ triggerWorkflow }));

const { copySequenceElements } = await import('./copy-sequence-elements');

function fakeDb(source: Record<string, unknown>) {
  const create = vi.fn(async (row: Record<string, unknown>) => row);
  // copy only reaches sequenceElements.list/create
  const scopedDb = asStub<ScopedDb>({
    sequenceElements: { list: vi.fn(async () => [source]), create },
  });
  return { scopedDb, create };
}

describe('copySequenceElements', () => {
  beforeEach(() => {
    copyFile.mockClear();
    triggerWorkflow.mockClear();
  });

  // #1559: the copy dropped both, so a duplicated clip landed as an IMAGE
  // (the column default) with no length — sent to image endpoints, and
  // waved past every length check on the video side.
  it('passes the trusted create snapshot when copied images need vision', async () => {
    const { scopedDb } = fakeDb({
      token: 'SMOKE_INK',
      uploadedFilename: 'smoke-ink.png',
      imagePath: 'elements/organization-1/seq-a/el-1.png',
      imageUrl: null,
      kind: 'image',
      durationSeconds: null,
      personInMedia: false,
      visionStatus: 'pending',
      description: null,
      consistencyTag: null,
      visionGeneratedAt: null,
    });
    const modelConfiguration = DEFAULT_MODEL_CONFIGURATION;

    await copySequenceElements({
      promptLocale: 'en',
      modelConfiguration,
      scopedDb,
      organizationId: 'organization-1',
      userId: 'user-1',
      sourceSequenceId: 'seq-a',
      targetSequenceId: 'seq-b',
    });

    expect(triggerWorkflow).toHaveBeenCalledWith(
      '/element-vision',
      expect.objectContaining({ organizationId: 'organization-1' }),
      { modelConfiguration }
    );
  });

  it('carries a clip’s kind and length', async () => {
    const { scopedDb, create } = fakeDb({
      token: 'SMOKE_INK',
      uploadedFilename: 'smoke-ink.mp4',
      imagePath: 'elements/organization-1/seq-a/el-1.mp4',
      kind: 'video',
      durationSeconds: 22.5,
      personInMedia: true,
      visionStatus: 'pending',
      description: null,
      consistencyTag: null,
      visionGeneratedAt: null,
    });

    await copySequenceElements({
      promptLocale: 'en',
      scopedDb,
      organizationId: 'organization-1',
      userId: 'user-1',
      sourceSequenceId: 'seq-a',
      targetSequenceId: 'seq-b',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'video',
        durationSeconds: 22.5,
        personInMedia: true,
      })
    );
    // Vision reads pixels; a clip has none, so no vision run even though the
    // source never finished one.
    expect(triggerWorkflow).not.toHaveBeenCalled();
  });
});
