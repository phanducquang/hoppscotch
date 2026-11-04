import { fileURLToPath } from 'node:url';

// Reuse the workspace's existing Vitest installation in hoppscotch-common.
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { environment: 'node', include: ['tests/**/*.spec.ts'] },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      vitest: fileURLToPath(
        new URL(
          '../hoppscotch-common/node_modules/vitest/dist/index.js',
          import.meta.url
        )
      ),
    },
  },
};
