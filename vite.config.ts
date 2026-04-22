import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

// Copy /cards -> dist/cards after build so standalone card templates ship
// inside the extension as web_accessible_resources.
function copyCardsPlugin(): Plugin {
  return {
    name: 'copy-cards',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'cards');
      const dest = resolve(__dirname, 'dist', 'cards');
      if (!existsSync(src)) return;
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    },
  };
}

// Popup + background build. Background can stay ESM (service_worker type:
// module). The content script is built in a separate IIFE pass because
// Chrome content scripts do not support top-level ESM imports.
export default defineConfig({
  plugins: [react(), copyCardsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return '[name].js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
