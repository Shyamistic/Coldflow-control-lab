import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: { baseURL: process.env.TEST_URL || 'http://127.0.0.1:4180', browserName: 'chromium', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, trace: 'retain-on-failure' },
  webServer: process.env.TEST_URL ? undefined : { command: 'node --experimental-strip-types server/index.mjs', port: 4180, env: { PORT: '4180', ENABLE_VERTEX: 'false' }, reuseExistingServer: false },
})