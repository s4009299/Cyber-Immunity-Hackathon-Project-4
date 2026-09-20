import { defineConfig, devices } from '@playwright/test'

// Playwright config for the Tide-protected customer support spike.
//
// Scope and intent (see e2e/README.md for full detail):
// - These are smoke/contract tests against the running Next.js app.
// - They deliberately do NOT authenticate as a real Tide user. No usernames,
//   passwords, tokens, or Tide enclave approvals are stored or automated here.
// - Tests only assert on: (a) public page rendering, (b) the unauthenticated
//   sign-in UI being present, and (c) server-side rejection of a protected
//   API route when no valid bearer token is supplied.
// - `webServer` starts the app consistently for `npm run test:e2e`; it does
//   NOT start or depend on the TideCloak container. Any test that would
//   require a live TideCloak login is out of scope by design.

const PORT = process.env.PLAYWRIGHT_PORT ?? '3100'
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use the system-installed Edge (Chromium-based) channel rather than
        // Playwright's own downloaded browser binary. This is a supported
        // Playwright configuration, not a test-weakening workaround: Edge is
        // Chromium under the hood and exercises the same rendering/JS engine.
        channel: 'msedge',
      },
    },
  ],
  webServer: {
    // Production build + start, so the tests exercise what actually ships,
    // not the dev server. `npm run test:e2e` builds first (see package.json).
    command: `npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
