import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': process.env.API_TARGET ?? 'http://localhost:8787',
      '/ws': {
        target: (process.env.API_TARGET ?? 'http://localhost:8787').replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
});
