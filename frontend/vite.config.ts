import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Инъекция временной метки сборки: позволяет клиенту мгновенно определять новый билд
  define: {
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7860',
        changeOrigin: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'vendor';
          }
          if (id.includes('@capacitor')) {
            return 'capacitor';
          }
          if (id.includes('hls.js')) {
            return 'hls';
          }
        }
      }
    }
  }
})
