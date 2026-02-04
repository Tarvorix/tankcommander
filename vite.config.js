import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Use root paths locally so HMR/dev works reliably; keep GitHub Pages base for builds.
  base: command === 'serve' ? '/' : '/tankcommander/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}));
