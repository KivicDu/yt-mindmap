import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // markmap + d3 + katex are lazily loaded (see App.tsx), so the initial
    // bundle stays small without hand-splitting interdependent vendor modules.
    chunkSizeWarningLimit: 700,
  },
})
