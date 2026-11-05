import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = new Map<string, string>();
const key = 'openstory.assistant';

function storedPreferences(): unknown {
  const saved = storage.get(key);
  if (saved === undefined)
    throw new Error('Assistant preferences were not saved');
  return JSON.parse(saved);
}

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('assistant model preferences', () => {
  it('does not store a model just from opening or resizing the assistant', async () => {
    const store = await import('./assistant-store');
    store.openAssistant();
    store.setAssistantWidth(450);
    expect(store.getAssistantState().model).toBeNull();
    expect(storedPreferences()).not.toHaveProperty('model');
  });

  it('retains a legacy explicit model', async () => {
    storage.set(
      key,
      JSON.stringify({
        open: true,
        threadId: 'saved-thread',
        model: 'z-ai/glm-5.3-flash',
      })
    );
    const store = await import('./assistant-store');
    expect(store.getAssistantState().model).toBe('z-ai/glm-5.3-flash');
    store.startAssistantThread();
    expect(storedPreferences()).toMatchObject({ model: 'z-ai/glm-5.3-flash' });
  });

  it('persists an actual model selection across reloads', async () => {
    const store = await import('./assistant-store');
    store.setAssistantModel('google/gemini-3.8-flash');
    vi.resetModules();
    const reloaded = await import('./assistant-store');
    expect(reloaded.getAssistantState().model).toBe('google/gemini-3.8-flash');
  });

  it('drops a retired stored model so the live administrator default can apply', async () => {
    storage.set(
      key,
      JSON.stringify({
        open: false,
        threadId: 'saved-thread',
        model: 'retired',
      })
    );
    const store = await import('./assistant-store');
    expect(store.getAssistantState().model).toBeNull();
  });
});

describe('custom assistant model preferences', () => {
  it.each(['custom:private/draft', 'custom:disabled-model'])(
    'retains %s before its asynchronous catalog can be checked',
    async (model) => {
      storage.set(
        key,
        JSON.stringify({ open: true, threadId: 'saved-thread', model })
      );
      const store = await import('./assistant-store');
      expect(store.getAssistantState().model).toBe(model);
      store.setAssistantWidth(450);
      expect(storedPreferences()).toMatchObject({ model });
    }
  );

  it('persists an explicit custom selection across reloads', async () => {
    const store = await import('./assistant-store');
    store.setAssistantModel('custom:private/draft');
    store.startAssistantThread();
    vi.resetModules();
    const reloaded = await import('./assistant-store');
    expect(reloaded.getAssistantState().model).toBe('custom:private/draft');
  });

  it.each(['custom:', 'custom:has space', 'custom:/invalid'])(
    'rejects malformed custom identity %s',
    async (model) => {
      storage.set(
        key,
        JSON.stringify({ open: false, threadId: 'saved-thread', model })
      );
      const store = await import('./assistant-store');
      expect(store.getAssistantState().model).toBeNull();
    }
  );
});
