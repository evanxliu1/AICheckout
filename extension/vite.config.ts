import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { siteAdapterSchema } from './src/checkout/adapters/schema';

// Site adapters are bundled data; reject an invalid spec at build time, not at checkout.
const adapterDir = new URL('./src/checkout/adapters/', import.meta.url);
const adapters = readdirSync(adapterDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((file) => siteAdapterSchema.parse(JSON.parse(readFileSync(new URL(file, adapterDir), 'utf8'))));
/** The automatic badge's reach, derived from the adapters: exactly their hosts and pages. */
export const BADGE_HOSTS = [...new Set(adapters.flatMap((adapter) => adapter.match.hosts))].sort();
export const BADGE_MATCHES = adapters.flatMap((adapter) => adapter.matchPatterns);

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const endpoint = env.VITE_CATALOG_API_URL;
  const e2eCatalogDate = env.VITE_E2E_CATALOG_DATE;
  const configured = {
    ...structuredClone(manifest),
    host_permissions: BADGE_HOSTS.map((host) => `https://${host}/*`),
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
    configured.host_permissions = [...configured.host_permissions, `${url.origin}/*`];
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
      for (const [entry, fileName] of [
        ['./src/checkout/content.ts', 'src/checkout/content.js'],
        ['./src/badge/content.ts', 'src/badge/content.js'],
      ]) {
        const result = await esbuild({
          entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
          bundle: true,
          format: 'iife',
          minify: true,
          target: 'chrome120',
          legalComments: 'none',
          write: false,
        });
        this.emitFile({ type: 'asset', fileName, source: result.outputFiles[0].text });
      }
    },
  };
  // The badge content script and its iframe page are added to the manifest crxjs wrote, so
  // crxjs does not rebuild the content script with a module loader. Both are limited to the
  // adapters' hosts and pages.
  const badgeManifest = {
    name: 'badge-manifest',
    apply: 'build' as const,
    enforce: 'post' as const,
    writeBundle(options: { dir?: string }) {
      const path = `${options.dir}/manifest.json`;
      const generated = JSON.parse(readFileSync(path, 'utf8'));
      generated.content_scripts = [
        { matches: BADGE_MATCHES, js: ['src/badge/content.js'], run_at: 'document_idle', all_frames: false },
      ];
      // The manual reader (src/checkout/content.js) needs no web-accessible entry: it is injected
      // with chrome.scripting.executeScript({ files }), which pages cannot request.
      // The badge page stays at a static URL (use_dynamic_url: false) because the worker identifies
      // its sender by that URL; a per-frame nonce (URL fragment) stops page-made copies instead.
      generated.web_accessible_resources = [
        {
          matches: BADGE_HOSTS.map((host) => `https://${host}/*`),
          resources: ['src/badge/index.html'],
          use_dynamic_url: false,
        },
      ];
      writeFileSync(path, JSON.stringify(generated, null, 2));
    },
  };
  return {
    plugins: [react(), crx({ manifest: configured }), e2eGuard, contentScript, badgeManifest],
    build: {
      outDir: e2eCatalogDate ? 'dist-e2e' : 'dist',
      rollupOptions: {
        input: {
          popup: 'src/popup/index.html',
          badge: 'src/badge/index.html',
          onboarding: 'src/onboarding/index.html',
        },
      },
    },
  };
});
