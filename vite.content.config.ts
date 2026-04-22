import { defineConfig } from 'vite';
import { resolve } from 'path';

// Builds the content script as a single, self-contained IIFE so Chrome can
// load it directly (MV3 content scripts do not support ESM `import`).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false, // keep output from the main build
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'WildsContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        // Everything inlined into content.js.
        inlineDynamicImports: true,
      },
    },
  },
});
