import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    fs: { strict: true },
    // Honor an externally assigned port (e.g. the preview launcher's), so two
    // dev servers on this repo never fight over 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
