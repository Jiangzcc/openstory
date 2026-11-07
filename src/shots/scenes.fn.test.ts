import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateId } from '@/platform/id';
import type { SceneRow } from '@/platform/server/db/schema';
import { dbSceneId } from './scene-id';

const mocks = vi.hoisted(() => ({
  updateScene: vi.fn(),
  getByIdForScene: vi.fn(),
  getSelected: vi.fn(),
}));
// Stub the RPC boundary so the production handler runs with an explicit context.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock('@/platform/middleware.fn', () => ({ sequenceAccessMiddleware: {} }));
vi.mock('@/shots/server/scene-edit', () => ({
  updateScene: mocks.updateScene,
}));
vi.mock('@/shots/server/scene-script', () => ({
  composeSequenceScriptFromDb: vi.fn(),
  loadSceneContextBySequence: vi.fn(),
}));
vi.mock('@/shots/server/structure-edit', () => ({
  createScene: vi.fn(),
  requireSceneInSequence: vi.fn(),
}));
import { updateSceneFn } from './scenes.fn';

const sequenceId = generateId();
const sceneId = dbSceneId(generateId());
const context = {
  scopedDb: {
    sceneScriptVersions: {
      getByIdForScene: mocks.getByIdForScene,
      getSelected: mocks.getSelected,
    },
  },
  sequence: { id: sequenceId },
  user: { id: generateId() },
};
const invoke = z
  .custom<
    (input: {
      context: typeof context;
      data: { sequenceId: string; sceneId: string; title: string };
    }) => Promise<unknown>
  >((value) => typeof value === 'function')
  .parse(updateSceneFn);
const input = { context, data: { sequenceId, sceneId, title: 'Opening' } };

function sceneFixture(selectedScriptVersionId: string | null): SceneRow {
  return {
    id: sceneId,
    sequenceId,
    orderIndex: 0,
    selectedScriptVersionId,
    deletedAt: null,
    createdAt: new Date('2026-11-07T00:00:00Z'),
    updatedAt: new Date('2026-11-07T00:00:00Z'),
    title: 'Opening',
    location: null,
    timeOfDay: null,
    storyBeat: null,
    continuity: null,
  };
}

beforeEach(() => vi.resetAllMocks());

describe('updateSceneFn saved script projection', () => {
  it('returns the saved immutable script even when the live selection moved', async () => {
    const scene = sceneFixture(generateId());
    const script = { extract: 'The saved scene script.', dialogue: [] };
    mocks.updateScene.mockResolvedValue({ scene, changed: true });
    mocks.getByIdForScene.mockResolvedValue({
      id: scene.selectedScriptVersionId,
      sceneId,
      content: script,
    });
    mocks.getSelected.mockResolvedValue({
      id: generateId(),
      content: { extract: 'A later edit by another writer.', dialogue: [] },
    });

    expect(await invoke(input)).toEqual({ ...scene, script });
    expect(mocks.getByIdForScene).toHaveBeenCalledExactlyOnceWith(
      scene.selectedScriptVersionId,
      scene.id
    );
    expect(mocks.getSelected).not.toHaveBeenCalled();
  });

  it('returns a null script without reading a live selection when none was saved', async () => {
    const scene = sceneFixture(null);
    mocks.updateScene.mockResolvedValue({ scene, changed: false });
    mocks.getSelected.mockRejectedValue(new Error('No live read allowed'));
    mocks.getByIdForScene.mockRejectedValue(new Error('No version selected'));

    expect(await invoke(input)).toEqual({ ...scene, script: null });
    expect(mocks.getByIdForScene).not.toHaveBeenCalled();
    expect(mocks.getSelected).not.toHaveBeenCalled();
  });
});
