/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    // fixture generators are run on demand: npx vitest run src/examples/plans.fixture.test.ts
    exclude: ['**/node_modules/**', '**/*.fixture.test.ts'],
  },
});
