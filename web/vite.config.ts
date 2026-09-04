import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    // Type-only imports of the server's shared types: `import type { RunSnapshot } from '@shared/types'`.
    alias: { '@shared': path.resolve(__dirname, '../server') },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: { outDir: path.resolve(__dirname, '../dist'), emptyOutDir: true },
});
