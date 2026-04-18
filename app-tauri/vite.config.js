import { defineConfig } from 'vite';

// Tauri expects a fixed port; fail if unavailable
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'safari15',
    minify: false,
    sourcemap: true,
  },
});
