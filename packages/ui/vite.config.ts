// Dev server and static build for the component gallery (not shipped).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'gallery',
  plugins: [react()],
  server: { port: 5178, strictPort: true },
  preview: { port: 5178, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
