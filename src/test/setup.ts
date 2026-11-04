/**
 * Test setup file — loaded via vitest.config.ts setupFiles.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@/mocks/server';
import { setI18n } from 'react-i18next';
import { createApplicationI18n } from '@/ui/i18n/runtime';

setI18n(createApplicationI18n('en'));

// Enable API mocking before all tests
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'bypass' });
});

// Reset request handlers after each test
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
