// Public site: a Vite multi-page build whose pages are rendered to static HTML at build time with
// React and @ai-checkout/ui. The evaluation results, their charts and the release screenshots are
// copied in from docs/ during the build, so the site always matches the committed data.
import { defineConfig, createServer, type Plugin, type ViteDevServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(root, '../..');
const PAGES = {
  'index.html': 'home',
  'results/index.html': 'results',
  'architecture/index.html': 'architecture',
  'privacy/index.html': 'privacy',
  'support/index.html': 'support',
} as const;
/** Published path → source file in the repository. */
export const COPIED: Record<string, string> = {
  'results/results.json': 'docs/evals/results.json',
  'results/results.svg': 'docs/evals/results.svg',
  'results/results-heldout.svg': 'docs/evals/results-heldout.svg',
  'results/expansion.json': 'docs/evals/expansion.json',
  'media/1-wallet.png': 'docs/release/assets/1-wallet-640x400.png',
  'media/2-comparison.png': 'docs/release/assets/2-comparison-640x400.png',
  'media/3-uncertainty.png': 'docs/release/assets/3-uncertainty-640x400.png',
  'media/4-subtotal.png': 'docs/release/assets/4-subtotal-640x400.png',
};
const TYPES: Record<string, string> = { json: 'application/json', svg: 'image/svg+xml', png: 'image/png' };

type Renderer = { renderPage: (id: string) => { head: string; body: string } };

function staticPages(): Plugin {
  let dev: ViteDevServer | undefined;
  // Build only: one SSR server loads the TSX renderer (and its workspace imports) for every page.
  // Pages are transformed concurrently, so the promise is cached, not the server.
  let ssr: Promise<ViteDevServer> | undefined;
  async function renderer(): Promise<Renderer> {
    const server =
      dev ??
      (await (ssr ??= createServer({
        root,
        configFile: false,
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'custom',
      })));
    return (await server.ssrLoadModule('/src/render.tsx')) as Renderer;
  }
  return {
    name: 'ai-checkout-static-pages',
    configureServer(server) {
      dev = server;
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?')[0].replace(/^\//, '');
        const source = COPIED[path];
        if (!source) return next();
        response.setHeader('Content-Type', TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream');
        response.end(await readFile(resolve(repo, source)));
      });
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, context) {
        const file = relative(root, context.filename).split('\\').join('/') as keyof typeof PAGES;
        const id = PAGES[file];
        if (!id) throw new Error(`No page is registered for ${file}.`);
        const { head, body } = (await renderer()).renderPage(id);
        return html.replace('<!--page-head-->', head).replace('<!--page-body-->', body);
      },
    },
    async closeBundle() {
      const server = ssr;
      ssr = undefined;
      await (await server)?.close();
    },
    async generateBundle() {
      for (const [fileName, source] of Object.entries(COPIED))
        this.emitFile({ type: 'asset', fileName, source: await readFile(resolve(repo, source)) });
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  plugins: [staticPages()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(Object.keys(PAGES).map((file) => [file, resolve(root, file)])),
      output: {
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'assets/site-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { port: 5180, strictPort: true, fs: { allow: [repo] } },
  preview: { port: 5180, strictPort: true },
});
