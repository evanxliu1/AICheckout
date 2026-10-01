// Build-time renderer: the Vite plugin in vite.config.ts loads this module and writes each page's
// markup into its HTML file, so the published site is static HTML and CSS with one small script.
import { renderToStaticMarkup } from 'react-dom/server';
import { page } from './pages';
import type { PageId } from './Layout';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPage(id: PageId) {
  const { title, description, body } = page(id);
  return {
    head: `<title>${escape(title)}</title><meta name="description" content="${escape(description)}" />`,
    body: renderToStaticMarkup(body),
  };
}
