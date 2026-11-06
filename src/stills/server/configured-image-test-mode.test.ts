import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireSafeImageTestEndpoint } from './configured-image-test-mode';
const environment = vi.hoisted(() => ({ E2E_TEST: 'true', E2E_RECORD: '0' }));
vi.mock('#env', () => ({ getEnv: () => environment }));
beforeEach(() => {
  environment.E2E_TEST = 'true';
  environment.E2E_RECORD = '0';
});

describe('configured image replay boundary', () => {
  it('permits local mock channels and blocks remote generation in replay', () => {
    expect(() =>
      requireSafeImageTestEndpoint('http://127.0.0.1:4010/v1')
    ).not.toThrow();
    expect(() =>
      requireSafeImageTestEndpoint('https://example.com/v1')
    ).toThrow('local mock');
  });
  it('preserves explicitly recorded and normal execution', () => {
    environment.E2E_RECORD = '1';
    expect(() =>
      requireSafeImageTestEndpoint('https://example.com/v1')
    ).not.toThrow();
    environment.E2E_RECORD = '0';
    environment.E2E_TEST = 'false';
    expect(() =>
      requireSafeImageTestEndpoint('https://example.com/v1')
    ).not.toThrow();
  });
});
