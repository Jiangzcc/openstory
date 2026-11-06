import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import { AUTH_SESSION_QUERY_KEY } from '@/platform/ui/auth/auth-cache-generation';
import { useConfiguredImageControls } from './use-configured-image-controls';

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
// Uploads, catalog and auth transitions are synthetic; hook callbacks and QueryClient execute.
vi.mock('@/models/ui/use-image-model-catalog', () => ({
  useImageModelCatalog: () => ({
    models: mergeImageModelCatalog([
      imageCatalogFixture({ id: 'gpt_image_2' }),
    ]),
  }),
}));
vi.mock('@/platform/ui/auth/auth-gate-provider', () => ({
  useAuthGate: () => ({ requireAuth: (action: () => void) => action() }),
}));
vi.mock('./use-studio-assets', () => ({
  studioUploadKeys: { all: ['mock-studio-uploads'] },
  useUploadStudioMedia: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));
const clients: QueryClient[] = [];
const uploaded = { url: '/r2/mock-old-organization/mask.png' };
const session = { user: { id: 'mock-user' }, session: { id: 'mock-session' } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function startUpload() {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(AUTH_SESSION_QUERY_KEY, session);
  const pending = deferred<typeof uploaded>();
  mocks.upload.mockReturnValueOnce(pending.promise);
  const snapshots: ReturnType<typeof useConfiguredImageControls>[] = [];
  function Probe() {
    const controls = useConfiguredImageControls({
      modelId: 'gpt_image_2',
      aspectRatio: '1:1',
      referenceCount: 1,
      totalImageCount: 1,
    });
    snapshots.push(controls);
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const controls = snapshots[0];
  if (!controls) throw new Error('Missing mock controls.');
  controls.chooseMaskFile(
    new File(['mock-mask'], 'mask.png', { type: 'image/png' })
  );
  return { client, pending };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('image mask upload authentication lifecycle', () => {
  it.each(['logout', 'other-account', 'same-account', 'organization'])(
    'ignores a delayed upload after %s without refreshing current uploads',
    async (transition) => {
      const { client, pending } = startUpload();
      client.clear();
      client.setQueryData(
        AUTH_SESSION_QUERY_KEY,
        transition === 'logout'
          ? null
          : transition === 'other-account'
            ? {
                user: { id: 'mock-other' },
                session: { id: 'mock-other-session' },
              }
            : session
      );
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      pending.resolve(uploaded);
      await pending.promise;
      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it('refreshes uploads after completion in the same session generation', async () => {
    const { client, pending } = startUpload();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    pending.resolve(uploaded);
    await pending.promise;
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['mock-studio-uploads'],
    });
  });
});
