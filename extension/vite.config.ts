import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const endpoint = loadEnv(mode, process.cwd(), 'VITE_').VITE_CATALOG_API_URL;
  const configured = { ...structuredClone(manifest), host_permissions: [] as string[] };
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/v1/catalog'
    ) {
      throw new Error('VITE_CATALOG_API_URL must be a fixed HTTPS /v1/catalog endpoint.');
    }
    configured.host_permissions = [`${url.origin}/*`];
  }
  return {
    plugins: [react(), crx({ manifest: configured })],
    build: {
      rollupOptions: {
        input: {
          popup: 'src/popup/index.html',
        },
      },
    },
  };
});
