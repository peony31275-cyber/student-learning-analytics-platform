/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to Vite, Vite forwards /api
    // to Express. The httpOnly auth cookie therefore works without CORS tricks.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Charts are the heaviest dependency; split them so the login page loads fast.
        manualChunks: (id) =>
          id.includes('recharts') || id.includes('d3-') ? 'charts' : undefined,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
