import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.codex/hooks/*.test.mjs'],
    environment: 'node',
  },
});
