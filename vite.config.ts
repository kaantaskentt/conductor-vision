import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      thresholds: {
        statements: 50,
        branches: 35,
        functions: 40,
        lines: 50,
      },
    },
  },
})
