import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  root: import.meta.dirname,
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: 'dist/public', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
