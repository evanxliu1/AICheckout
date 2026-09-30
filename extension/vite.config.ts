import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const endpoint = env.VITE_CATALOG_API_URL;
  const e2eCatalogDate = env.VITE_E2E_CATALOG_DATE;
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
  // A re-dated bundled catalog is for browser tests only; never let it reach the release dist/.
  const e2eGuard = {
    name: 'e2e-catalog-guard',
    configResolved(config: { build: { outDir: string } }) {
      if (e2eCatalogDate && ['dist', ''].includes(config.build.outDir.replace(/\/+$/, '').split('/').pop()!))
        throw new Error('VITE_E2E_CATALOG_DATE builds must use a test output directory, not dist.');
    },
  };
  return {
    plugins: [react(), crx({ manifest: configured }), e2eGuard],
    build: {
      outDir: e2eCatalogDate ? 'dist-e2e' : 'dist',
      rollupOptions: {
        input: {
          popup: 'src/popup/index.html',
        },
      },
    },
  };
});
