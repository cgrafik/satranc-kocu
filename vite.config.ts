import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages alt yolda yayınlanır: BASE_PATH=/satranc-kocu/ (bkz. .github/workflows/pages.yml)
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
