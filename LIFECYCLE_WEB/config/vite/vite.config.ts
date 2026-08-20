import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  envDir: '..',
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
