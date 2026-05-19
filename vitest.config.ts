import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    // Use happy-dom for browser-like environment
    environment: 'happy-dom',

    // Include test files
    include: ['tests/**/*.{test,spec}.{js,ts}'],

    // Exclude E2E tests (run with Playwright)
    exclude: ['tests/e2e/**', 'node_modules/**'],

    // Setup files run before each test file
    setupFiles: ['tests/setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.d.ts',
        'src/lib/**/index.ts',
        'src/lib/adapters/tauri/**',
      ],
    },

    // Global test configuration
    globals: true,

    // Alias resolution for SvelteKit
    alias: {
      $lib: '/src/lib',
      $app: '/tests/mocks/app',
    },
  },
});
