// End-to-end smoke tests against a production build with SAMPLE data.
//   npm run test:e2e
// Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium binary.
import { defineConfig, devices } from '@playwright/test';

const launchOptions = {
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
};

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 45_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4173/', launchOptions },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: {
    command: 'DATA_SOURCE=fixtures npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
