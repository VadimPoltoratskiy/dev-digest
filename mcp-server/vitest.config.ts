import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `paths` so the pre-push CLI's cross-package imports
    // (reviewer-core engine, shared contracts, reused server modules) resolve
    // under vitest too — Vite does not read tsconfig paths on its own.
    alias: {
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      '@devdigest/server': path.resolve(__dirname, '../server/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
