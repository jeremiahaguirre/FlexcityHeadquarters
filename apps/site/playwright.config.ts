/**
 * Browser tests (Chromium) against the static site build, served with vercel.json's headers.
 *   npm run build && npm run test:e2e
 * SITE_OUT points at another build folder; E2E_PORT changes the port.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3101);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off', timezoneId: 'America/Vancouver' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'iphone-13', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `node e2e/serve-site.cjs ${PORT}`,
    url: `http://localhost:${PORT}/en/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
