import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron は dist/index.html を file:// で読むため、相対パスで出力する。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
