import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'assets',
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
