import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// URL du backend Render en production
const renderBackendUrl = 'https://toxonomy-backend.onrender.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  },
  define: {
    'process.env': {}
  },
  build: {
    outDir: 'dist'
  },
  // Optionnel : corrige les chemins pour le mode static
  base: '/',
})
