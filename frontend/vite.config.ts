import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时 /api 代理到后端 8080；生产环境由后端直接托管 dist 产物
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
