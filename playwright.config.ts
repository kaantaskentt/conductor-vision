import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/camera-lifecycle.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  timeout: 240_000,
  expect: {
    timeout: 45_000,
  },
  reporter: isCi ? [['line'], ['github']] : 'line',
  outputDir: 'output/playwright/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-camera',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
