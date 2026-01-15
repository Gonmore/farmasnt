/// <reference types="vite/client" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Determine backend target based on environment
const getBackendTarget = () => {
  // In development (vite dev), use localhost
  // In production (vite preview/Docker), use backend service
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? 'http://backend-farmasnt:6000' : 'http://127.0.0.1:6000';
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 6001,
    strictPort: false,
    // Allow testing with custom local domains via hosts file (e.g. farmacia.supernovatel.com)
    allowedHosts: ['localhost', '127.0.0.1', '.supernovatel.com', '.febsa.com'],
    proxy: {
      // Avoid Chromium ERR_UNSAFE_PORT for :6000 by proxying through Vite (:6001)
      // In Docker, this should point to the backend service (e.g. http://backend-farmasnt:6000)
      '/api': {
        target: getBackendTarget(),
        changeOrigin: true,
        xfwd: true,
      },
      // Socket.io uses this path by default
      '/socket.io': {
        target: getBackendTarget(),
        ws: true,
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  // NOTE: `vite preview` uses a different config key (`preview.allowedHosts`).
  // Our Docker image serves the built app via `vite preview`, so we must allow
  // the production domain(s) here too.
  preview: {
    allowedHosts: ['localhost', '127.0.0.1', '.supernovatel.com', '.febsa.com'],
    // In Docker production, proxy to backend service
    proxy: {
      '/api': {
        target: getBackendTarget(),
        changeOrigin: true,
        xfwd: true,
      },
      '/socket.io': {
        target: getBackendTarget(),
        ws: true,
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
})
