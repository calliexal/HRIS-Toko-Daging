import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Capacitor memuat file dari dist/ lewat file:// atau skema capacitor://, jadi base harus relatif.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Sama dengan target demo esbuild: WebView Android 9+ dan iOS 15+.
    target: ['es2020', 'safari15'],
    sourcemap: true,
  },
  server: { host: true, port: 5173 },
});
