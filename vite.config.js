import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/reactor': {
        target: 'https://api.reactor.inc',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/reactor/, ''),
      },
    },
  },
})
