import { getEnv } from '#env';

const IMAGE_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export function requireSafeImageTestEndpoint(baseUrl: string): void {
  const env = getEnv();
  if (env.E2E_TEST !== 'true' || env.E2E_RECORD === '1') return;
  if (!IMAGE_TEST_HOSTS.has(new URL(baseUrl).hostname)) {
    throw new Error('Image replay requires a local mock channel endpoint.');
  }
}
