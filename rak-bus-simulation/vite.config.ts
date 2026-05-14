import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'singlefile' ? [viteSingleFile()] : []),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    sourcemap: mode !== 'singlefile',
    // Inline all assets when building single-file.
    assetsInlineLimit: mode === 'singlefile' ? 100_000_000 : 4096,
    cssCodeSplit: false,
    rollupOptions: mode === 'singlefile' ? {
      output: {
        inlineDynamicImports: true,
      },
    } : {},
  },
  optimizeDeps: {
    include: ['maplibre-gl', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
  },
}));
