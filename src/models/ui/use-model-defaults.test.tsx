import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '../model-configuration';
const { getModelConfigurationFn } = vi.hoisted(() => ({
  getModelConfigurationFn: vi.fn(),
}));
vi.mock('@/models/model-configuration.fn', () => ({ getModelConfigurationFn }));
import { modelConfigurationQueryOptions } from '../model-configuration.queries';
import { useModelDefaults } from './use-model-defaults';

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  function Probe() {
    const { configuration, isReady } = useModelDefaults();
    return <span data-ready={isReady}>{configuration.defaultAnalysis}</span>;
  }
  const render = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  return { client, render };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.resetAllMocks();
});

describe('shared public model defaults', () => {
  it('keeps generation unready until the server configuration is available', () => {
    const { render } = setup();
    expect(render()).toContain('data-ready="false"');
  });

  it('fetches public defaults without a session dependency', async () => {
    const { client, render } = setup();
    const configuration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultAnalysis: 'z-ai/glm-5.3-flash' as const,
    };
    getModelConfigurationFn.mockResolvedValue(configuration);
    await client.fetchQuery(modelConfigurationQueryOptions);
    expect(getModelConfigurationFn).toHaveBeenCalledExactlyOnceWith();
    expect(render()).toContain('z-ai/glm-5.3-flash');
    expect(render()).toContain('data-ready="true"');
  });

  it('consumes an updated shared configuration after invalidation', async () => {
    const { client, render } = setup();
    client.setQueryData(
      modelConfigurationQueryOptions.queryKey,
      DEFAULT_MODEL_CONFIGURATION
    );
    const changed = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultAnalysis: 'google/gemini-3.8-flash' as const,
    };
    getModelConfigurationFn.mockResolvedValue(changed);
    await client.invalidateQueries({
      queryKey: modelConfigurationQueryOptions.queryKey,
    });
    await client.fetchQuery(modelConfigurationQueryOptions);
    expect(render()).toContain(changed.defaultAnalysis);
  });

  it('surfaces configuration failures to the error boundary instead of enabling coded defaults', async () => {
    const { client, render } = setup();
    getModelConfigurationFn.mockRejectedValue(
      new Error('Configuration unavailable')
    );
    await expect(
      client.fetchQuery(modelConfigurationQueryOptions)
    ).rejects.toThrow('Configuration unavailable');
    expect(render).toThrow('Configuration unavailable');
  });
});
