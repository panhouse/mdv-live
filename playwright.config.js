// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for mdv-live E2E characterization tests.
 *
 * Each spec file boots its own `createMdvServer` instance against its own
 * mkdtemp fixture directory (see tests/e2e/helpers.js) — there is no shared
 * webServer here and no fixed baseURL/port, since suites may run
 * concurrently and must never collide on a hardcoded port.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
