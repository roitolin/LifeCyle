import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep browser configuration in LIFECYCLE_WEB/.env instead of sharing the
  // mobile app's root environment file.
  envDir: '.',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
  server: {
    port: 6050,
    fs: {
      allow: [fileURLToPath(new URL('../../../', import.meta.url))],
    },
  },
})
