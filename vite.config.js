import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the build works on any GitHub Pages path (user or project site).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        sources: resolve(import.meta.dirname, 'sources.html'),
        methodology: resolve(import.meta.dirname, 'methodology.html'),
        about: resolve(import.meta.dirname, 'about.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
