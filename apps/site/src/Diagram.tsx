// The two-systems diagram as inline SVG, in a wide layout (shown from 760 px) and a tall one for
// phones. Only one is displayed at a time (CSS display), so assistive technology reads one figure;
// the ordered list after it carries the same flow as text.
type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  label: string[];
  tone?: 'store' | 'model' | 'human';
};
/** `end` places the title at the right, clear of an arrow entering the group on the left. */
type Group = { x: number; y: number; w: number; h: number; title: string; align?: 'end' };
type Edge = { points: [number, number][]; label?: { x: number; y: number; text: string } };
type Layout = { width: number; height: number; groups: Group[]; boxes: Box[]; edges: Edge[] };

const H = 56;
const wide: Layout = (() => {
  const w = 156,
    gap = 32,
    x = (i: number) => 32 + i * (w + gap);
  const top = 64,
    middle = 214,
    bottom = 364;
  return {
    width: 960,
    height: 470,
    groups: [
      { x: 16, y: 16, w: 928, h: 124, title: 'Catalog curation (maintainer)' },
      { x: 16, y: 316, w: 928, h: 138, title: 'Chrome extension (shopper, works offline)', align: 'end' },
    ],
    boxes: [
      { id: 'terms', x: x(0), y: top, w, label: ['Issuer terms', '(captured pages)'] },
      { id: 'llm', x: x(1), y: top, w, label: ['LLM extraction', 'harness'], tone: 'model' },
      { id: 'checks', x: x(2), y: top, w, label: ['Schema and', 'citation checks'] },
      { id: 'review', x: x(3), y: top, w, label: ['Human review', 'of every change'], tone: 'human' },
      { id: 'publish', x: x(4), y: top, w, label: ['Explicit', 'publication'], tone: 'human' },
      { id: 'db', x: x(4), y: middle, w, label: ['PostgreSQL:', 'immutable releases'], tone: 'store' },
      { id: 'api', x: x(2), y: middle, w, label: ['GET /v1/catalog', '(public, read-only)'] },
      { id: 'catalog', x: x(0), y: bottom, w, label: ['Cached or', 'bundled catalog'], tone: 'store' },
      { id: 'engine', x: x(1), y: bottom, w, label: ['Deterministic', 'rewards engine'] },
      { id: 'worker', x: x(2), y: bottom, w, label: ['Service worker'] },
      { id: 'popup', x: x(3), y: bottom, w, label: ['Popup: your cards', 'and the purchase'] },
      { id: 'reader', x: x(4), y: bottom, w, label: ['Cart reader', '(runs on click)'] },
    ],
    edges: [
      ...[0, 1, 2, 3].map((i): Edge => ({
        points: [
          [x(i) + w, top + H / 2],
          [x(i + 1), top + H / 2],
        ],
      })),
      {
        points: [
          [x(4) + w / 2, top + H],
          [x(4) + w / 2, middle],
        ],
      },
      {
        points: [
          [x(4), middle + H / 2],
          [x(2) + w, middle + H / 2],
        ],
      },
      {
        points: [
          [x(2), middle + H / 2],
          [x(0) + w / 2, middle + H / 2],
          [x(0) + w / 2, bottom],
        ],
        label: { x: x(0) + w / 2 + 8, y: middle + H / 2 - 10, text: 'on request, hosted builds' },
      },
      {
        points: [
          [x(0) + w, bottom + H / 2],
          [x(1), bottom + H / 2],
        ],
      },
      {
        points: [
          [x(2), bottom + H / 2],
          [x(1) + w, bottom + H / 2],
        ],
      },
      {
        points: [
          [x(3), bottom + H / 2],
          [x(2) + w, bottom + H / 2],
        ],
      },
      {
        points: [
          [x(4), bottom + H / 2],
          [x(3) + w, bottom + H / 2],
        ],
      },
    ],
  };
})();

const tall: Layout = (() => {
  const w = 236,
    x = 62,
    step = 84,
    y = (i: number) => 48 + i * step;
  const order: Box[] = [
    { id: 'terms', x, y: y(0), w, label: ['Issuer terms', '(captured pages)'] },
    { id: 'llm', x, y: y(1), w, label: ['LLM extraction harness'], tone: 'model' },
    { id: 'checks', x, y: y(2), w, label: ['Schema and citation checks'] },
    { id: 'review', x, y: y(3), w, label: ['Human review', 'of every change'], tone: 'human' },
    { id: 'publish', x, y: y(4), w, label: ['Explicit publication'], tone: 'human' },
    { id: 'db', x, y: y(5) + 16, w, label: ['PostgreSQL:', 'immutable releases'], tone: 'store' },
    { id: 'api', x, y: y(6) + 16, w, label: ['GET /v1/catalog', '(on request, hosted builds)'] },
    { id: 'catalog', x, y: y(7) + 64, w, label: ['Cached or bundled catalog'], tone: 'store' },
    { id: 'engine', x, y: y(8) + 64, w, label: ['Deterministic rewards engine'] },
    { id: 'worker', x, y: y(9) + 64, w, label: ['Service worker'] },
    { id: 'popup', x, y: y(10) + 64, w, label: ['Popup: your cards', 'and the purchase'] },
    { id: 'reader', x, y: y(11) + 64, w, label: ['Cart reader (runs on click)'] },
  ];
  const mid = x + w / 2;
  const down = (a: Box, b: Box): Edge => ({
    points: [
      [mid, a.y + H],
      [mid, b.y],
    ],
  });
  const up = (a: Box, b: Box): Edge => ({
    points: [
      [mid, a.y],
      [mid, b.y + H],
    ],
  });
  const [terms, llm, checks, review, publish, db, api, catalog, engine, worker, popup, reader] = order;
  return {
    width: 360,
    height: reader.y + H + 20,
    groups: [
      { x: 8, y: 8, w: 344, h: publish.y + H + 16 - 8, title: 'Catalog curation' },
      {
        x: 8,
        y: catalog.y - 40,
        w: 344,
        h: reader.y + H + 12 - (catalog.y - 40),
        title: 'Chrome extension',
      },
    ],
    boxes: order,
    edges: [
      down(terms, llm),
      down(llm, checks),
      down(checks, review),
      down(review, publish),
      down(publish, db),
      down(db, api),
      down(api, catalog),
      down(catalog, engine),
      up(worker, engine),
      up(popup, worker),
      up(reader, popup),
    ],
  };
})();

function Figure({ layout, className, titleId }: { layout: Layout; className: string; titleId: string }) {
  return (
    <svg
      className={`diagram ${className}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>
        Two systems, one contract: catalog curation publishes reviewed releases; the extension reads the
        published catalog and computes rewards locally.
      </title>
      <defs>
        <marker
          id={`${titleId}-arrow`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path className="diagram__arrowhead" d="M0 0 L10 5 L0 10 z" />
        </marker>
      </defs>
      {layout.groups.map((group) => (
        <g key={group.title}>
          <rect className="diagram__group" x={group.x} y={group.y} width={group.w} height={group.h} rx="8" />
          <text
            className="diagram__group-title"
            x={group.align === 'end' ? group.x + group.w - 14 : group.x + 14}
            y={group.y + 24}
            textAnchor={group.align === 'end' ? 'end' : 'start'}
          >
            {group.title}
          </text>
        </g>
      ))}
      {layout.edges.map((edge, index) => (
        <g key={index}>
          <polyline
            className="diagram__edge"
            points={edge.points.map((point) => point.join(',')).join(' ')}
            markerEnd={`url(#${titleId}-arrow)`}
          />
          {edge.label ? (
            <text className="diagram__edge-label" x={edge.label.x} y={edge.label.y}>
              {edge.label.text}
            </text>
          ) : null}
        </g>
      ))}
      {layout.boxes.map((box) => (
        <g key={box.id}>
          <rect
            className={`diagram__box${box.tone ? ` diagram__box--${box.tone}` : ''}`}
            x={box.x}
            y={box.y}
            width={box.w}
            height={H}
            rx="6"
          />
          <text className="diagram__label" x={box.x + box.w / 2} y={box.y + H / 2} textAnchor="middle">
            {box.label.map((line, i) => (
              <tspan
                key={line}
                x={box.x + box.w / 2}
                dy={i === 0 ? `${(-(box.label.length - 1) * 0.6 + 0.35).toFixed(2)}em` : '1.2em'}
              >
                {line}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SystemsDiagram() {
  return (
    <figure className="diagram-figure">
      <Figure layout={wide} className="diagram--wide" titleId="diagram-wide-title" />
      <Figure layout={tall} className="diagram--tall" titleId="diagram-tall-title" />
      <figcaption className="muted small">
        Blue: the language model. Green: human decisions. Gray: stored releases. The arrow from the API to the
        extension is the only network request the extension can make: one catalog GET when you choose Check
        for updated terms, in builds configured with the hosted catalog. The default build makes none and uses
        the catalog bundled with it.
      </figcaption>
    </figure>
  );
}
