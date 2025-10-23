import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  root: '.',
  plugins: [svelte()],
  build: {
    outDir: 'extension/dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        completed: path.resolve(__dirname, 'src/completed/main.js'),
        panel: path.resolve(__dirname, 'src/content/main.js'),
      },
      output: {
        entryFileNames: '[name].js'
      }
    }
  }
});
