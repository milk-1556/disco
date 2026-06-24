import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_URL ?? 'http://localhost:4000';

// Same-origin proxy to the API → no CORS, and SSE/streaming works cleanly.
const apiProxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: true,
    proxy: apiProxy,
  },
  // `vite preview` serves the production build with the same /api proxy, so a single origin (and a
  // single tunnel) exposes the whole app. allowedHosts:true accepts the ephemeral *.trycloudflare.com
  // host used for remote testing.
  preview: {
    port: Number(process.env.PREVIEW_PORT ?? 4173),
    host: true,
    allowedHosts: true,
    proxy: apiProxy,
  },
});
