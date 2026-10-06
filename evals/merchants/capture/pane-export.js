// Pane page export, format `pane-dom.1` (generic-reader-protocol.8). Approved by Evan on 2026-10-06 as the in-page
// export script for agent-driven capture in the Claude desktop app's browser pane. Dependency-free; it only reads the
// page. The operator runs this file's text with the pane's JavaScript tool on the page to capture. The script keeps
// the serialization on `window.__aiCheckoutPaneExport` and returns a short summary only (bytes, SHA-256, chunk
// count). The operator then fetches the chunks with `window.__aiCheckoutPaneExport.chunk(i)` and writes them, unread,
// to the gitignored capture data folder, and checks the SHA-256 there.
//
// What it records:
//   - every element with all its attributes, and every text node (whitespace-only text collapsed to one space);
//   - open shadow roots inlined as `sr` (rebuilt as declarative shadow DOM);
//   - `<script>` and `<noscript>` contents are not kept (the element and its attributes are);
//   - `<style>` contents are kept, so the rebuild has the page's own rules as well as computed styles;
//   - for every element, its computed `display` (`d`); for elements that hold their own text, and for img, input,
//     button, select and textarea, the computed STYLE_PROPS (`s`) and the bounding box (`b`, x/y/width/height
//     relative to the document);
//   - iframes are not walked: each is kept as an element with its origin and box, and counted;
//   - document `lang`, title, URL without query or fragment, viewport and scroll size.
// No input value, form state, cookie or storage is read.
(async () => {
  const STYLE_PROPS = [
    'display',
    'visibility',
    'opacity',
    'position',
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration-line',
    'text-transform',
    'white-space',
    'direction',
    'unicode-bidi',
  ];
  const BOXED = new Set(['img', 'input', 'button', 'select', 'textarea', 'svg']);
  const SKIP_TEXT = new Set(['script', 'noscript']);
  const MAX_NODES = 60000;
  const CHUNK = 400000;
  let nodes = 0;
  let truncated = false;
  let shadowRoots = 0;
  const iframes = [];

  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [
      Math.round(r.x + window.scrollX),
      Math.round(r.y + window.scrollY),
      Math.round(r.width),
      Math.round(r.height),
    ];
  };
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim() !== '');
  const origin = (src) => {
    try {
      return new URL(src, document.baseURI).origin;
    } catch {
      return null;
    }
  };

  function walkChildren(parent, tag) {
    const out = [];
    for (const n of parent.childNodes) {
      if (nodes >= MAX_NODES) {
        truncated = true;
        break;
      }
      if (n.nodeType === 3) {
        if (SKIP_TEXT.has(tag)) continue;
        const v = n.nodeValue;
        out.push({ x: v.trim() === '' ? ' ' : v });
        nodes += 1;
      } else if (n.nodeType === 1) {
        out.push(walk(n));
      }
    }
    return out;
  }

  function walk(el) {
    nodes += 1;
    const tag = el.localName;
    const node = { t: tag };
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    if (Object.keys(attrs).length) node.a = attrs;
    const cs = getComputedStyle(el);
    node.d = cs.display;
    if (tag === 'iframe' || tag === 'frame') {
      node.b = box(el);
      node.o = origin(el.getAttribute('src') || '');
      iframes.push({ origin: node.o, box: node.b });
      return node;
    }
    if (ownText(el) || BOXED.has(tag)) {
      node.s = STYLE_PROPS.map((p) => cs.getPropertyValue(p));
      node.b = box(el);
    }
    if (el.shadowRoot && el.shadowRoot.mode === 'open') {
      shadowRoots += 1;
      node.sr = walkChildren(el.shadowRoot, '#shadow');
    }
    const children = walkChildren(el, tag);
    if (children.length) node.c = children;
    return node;
  }

  const u = new URL(location.href);
  const doc = {
    format: 'pane-dom.1',
    url: `${u.origin}${u.pathname}`,
    lang: document.documentElement.getAttribute('lang') || '',
    title: document.title || '',
    viewport: [window.innerWidth, window.innerHeight],
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    styleProps: STYLE_PROPS,
    root: walk(document.documentElement),
  };
  doc.nodes = nodes;
  doc.truncated = truncated;
  doc.shadowRoots = shadowRoots;
  doc.iframes = iframes;

  const json = JSON.stringify(doc);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const chunks = Math.max(1, Math.ceil(json.length / CHUNK));
  window.__aiCheckoutPaneExport = {
    sha256,
    chunks,
    chunk: (i) => json.slice(i * CHUNK, (i + 1) * CHUNK),
  };
  return {
    format: 'pane-dom.1',
    url: doc.url,
    bytes: bytes.length,
    sha256,
    chunks,
    nodes,
    truncated,
    shadowRoots,
    iframes: iframes.length,
  };
})();
