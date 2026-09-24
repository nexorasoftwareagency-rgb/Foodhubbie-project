/**
 * @type {import('@playwright/test').PlaywrightTestConfig}
 */
const devices = {
  'Desktop Chrome': {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  'Pixel 5': {
    viewport: { width: 393, height: 851 },
    userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36',
    isMobile: true,
  },
};

module.exports = {
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'https://foodhubbie-admins.web.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  globalSetup: './tests/global-setup.js',
  globalTeardown: './tests/global-teardown.js',
};