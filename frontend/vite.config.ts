import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 6001,
    strictPort: true,
    // Allow testing with custom local domains via hosts file (e.g. farmacia.supernovatel.com)
    allowedHosts: ['localhost', '127.0.0.1', '.supernovatel.com', '.febsa.com'],
    proxy: {
      // Avoid Chromium ERR_UNSAFE_PORT for :6000 by proxying through Vite (:6001)
      '/api': {
        target: 'http://127.0.0.1:6000',
        changeOrigin: true,
        xfwd: true,
      },
      // Socket.io uses this path by default
      '/socket.io': {
        target: 'http://127.0.0.1:6000',
        ws: true,
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
})
