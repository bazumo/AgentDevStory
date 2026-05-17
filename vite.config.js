import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'assets',
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:4317',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
