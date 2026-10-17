import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, retries: 0, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list',
  webServer: [
    { command: '../backend/.venv/bin/python ../backend/manage.py runserver 127.0.0.1:8000 --noreload', url: 'http://127.0.0.1:8000/api/health', reuseExistingServer: !process.env.CI, timeout: 30_000 },
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
  ],
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
});
