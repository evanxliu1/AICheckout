// Grouped bar chart for the results page, drawn from results.json as inline SVG. Bars are sized
// with SVG attributes (the CSP forbids inline styles) and colored by class from site.css; each value
// is also printed as text, so the chart reads the same without color or graphics.
import type { ResultRow } from './results';
import { percent } from './results';

const SERIES: {
  key: keyof Pick<ResultRow, 'fieldAccuracy' | 'claimPrecision' | 'issueRecall'>;
  label: string;
}[] = [
  { key: 'fieldAccuracy', label: 'Field accuracy (end to end)' },
  { key: 'claimPrecision', label: 'Claim precision' },
  { key: 'issueRecall', label: 'Expected-issue recall' },
];

export const rowLabel = (row: ResultRow) =>
  `${row.model} · ${row.prompt} · ${row.selection}${row.addedAfter ? ' (added after)' : ''}`;

export function ResultsChart({ id, title, rows }: { id: string; title: string; rows: ResultRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.fieldAccuracy ?? 0) - (a.fieldAccuracy ?? 0));
  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="chart__title">
        {title}
      </figcaption>
      <ul className="chart__legend" aria-label="Series">
        {SERIES.map((series, index) => (
          <li key={series.key}>
            <svg className="chart__swatch" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <rect className={`chart__fill chart__fill--${index + 1}`} width="10" height="10" />
            </svg>
            {series.label}
          </li>
        ))}
      </ul>
      <ol className="chart__rows">
        {sorted.map((row) => (
          <li key={row.id} className="chart__row">
            <span className="chart__label">{rowLabel(row)}</span>
            <dl className="chart__bars">
              {SERIES.map((series, index) => {
                const value = row[series.key];
                return (
                  <div key={series.key} className="chart__bar">
                    <dt className="ac-visually-hidden">{series.label}</dt>
                    <dd>
                      <svg
                        className="chart__track"
                        viewBox="0 0 100 6"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <rect className="chart__background" width="100" height="6" />
                        {value !== null ? (
                          <rect
                            className={`chart__fill chart__fill--${index + 1}`}
                            width={(value * 100).toFixed(2)}
                            height="6"
                          />
                        ) : null}
                      </svg>
                      <span className="chart__value">{percent(value)}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ol>
      <p className="chart__axis muted small">
        Share of labeled fields, claims or expected issues, 0 to 100% (higher is better). Sorted by field
        accuracy.
      </p>
    </figure>
  );
}
