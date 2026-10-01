import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { siteAdapterSchema } from './src/checkout/adapters/schema';

// Site adapters are bundled data; reject an invalid spec at build time, not at checkout.
const adapterDir = new URL('./src/checkout/adapters/', import.meta.url);
for (const file of readdirSync(adapterDir).filter((name) => name.endsWith('.json')))
  siteAdapterSchema.parse(JSON.parse(readFileSync(new URL(file, adapterDir), 'utf8')));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const endpoint = env.VITE_CATALOG_API_URL;
  const e2eCatalogDate = env.VITE_E2E_CATALOG_DATE;
  const configured = {
    ...structuredClone(manifest),
    host_permissions: [] as string[],
    // Same entry crxjs generated for its `?script` import, so the packaged manifest is unchanged.
    web_accessible_resources: [
      {
        matches: ['http://*/*', 'https://*/*'],
        resources: ['src/checkout/content.js'],
        use_dynamic_url: false,
      },
    ],
  };
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
  // The injected reader is built here as one self-contained IIFE at a fixed path. (crxjs's
  // `?script` imports derive a placeholder from the absolute file path, which made the packaged
  // artifact's hash depend on where the repository was checked out.)
  const contentScript = {
    name: 'content-script-iife',
    apply: 'build' as const,
    async generateBundle(this: {
      emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void;
    }) {
      const result = await esbuild({
        entryPoints: [fileURLToPath(new URL('./src/checkout/content.ts', import.meta.url))],
        bundle: true,
        format: 'iife',
        minify: true,
        target: 'chrome120',
        legalComments: 'none',
        write: false,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'src/checkout/content.js',
        source: result.outputFiles[0].text,
      });
    },
  };
  return {
    plugins: [react(), crx({ manifest: configured }), e2eGuard, contentScript],
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
