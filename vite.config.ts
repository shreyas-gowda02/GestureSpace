import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  // The vision worker dynamically imports MediaPipe → needs code-splitting → ES module output.
  worker: { format: 'es' },
  preview: { port: 4173, strictPort: true },
  // three.js alone is ~600 kB minified; all seven experiences make ~1,019 kB (Phase 11). Chunk
  // splitting (e.g. loading each experience when first opened) is Phase 13 (performance).
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
});
