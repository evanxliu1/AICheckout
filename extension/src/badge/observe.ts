// What the automatic reader watches: changes in <body> that can move the order summary, and the
// direct children of <html>, where the badge host lives, so a page removing it is noticed at once.
export function observeCart(doc: Document, onChange: () => void): () => void {
  const body = new MutationObserver(onChange);
  body.observe(doc.body ?? doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'class', 'hidden'],
  });
  const root = new MutationObserver(onChange);
  root.observe(doc.documentElement, { childList: true });
  return () => {
    body.disconnect();
    root.disconnect();
  };
}
