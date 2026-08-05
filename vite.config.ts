import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Preserved for future experiments, but intentionally disconnected from
        // the shipped camera-first surface and its active coverage contract.
        'src/components/AppShell.tsx',
        'src/screens/DjRoomScreen.tsx',
        'src/screens/VisionScreen.tsx',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // Keep the safety net close to the current suite while leaving a small
        // amount of headroom for honest refactors. Lowering these values should
        // require an explicit review rather than silently eroding coverage.
        statements: 80,
        branches: 72,
        functions: 76,
        lines: 82,
      },
    },
  },
})
