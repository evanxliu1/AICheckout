/**
 * Prepare static HTML for text capture without scripts: open every `<details>` (dropping the shared `name`
 * that makes an exclusive accordion, where only one can be open) and append a style that shows every
 * element with its default display, since collapsed sections are otherwise hidden by the page's CSS.
 */
export function revealStaticHtml(html) {
  return (
    html.replace(
      /<details\b([^>]*)>/gi,
      (_tag, attributes) =>
        `<details open${attributes.replace(/\sopen\b(\s*=\s*("[^"]*"|'[^']*'|\S+))?/i, '').replace(/\sname\s*=\s*("[^"]*"|'[^']*'|\S+)/i, '')}>`,
    ) +
    '<style>* { display: revert !important; visibility: visible !important; max-height: none !important; } ' +
    'head, script, style, noscript, template { display: none !important; }</style>'
  );
}
