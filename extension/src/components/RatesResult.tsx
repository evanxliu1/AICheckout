// The rates view (Phase 13c): the owned cards ranked by rate when the cart amount was not read.
// Shared by the badge panel and the popup. It never asks for an amount.
import type { Catalog, Comparison } from '../domain';
import { merchantName } from '../checkout/merchants';
import { notAcceptedLines, rankingNote, rateWording, ratesCapped } from './estimates';

export const RATES_INTRO =
  'The cart amount wasn’t read on this page. Each card’s rate doesn’t depend on it, so the best card is the same at any amount';
export const RATES_CAP_NOTE =
  'A spend cap on one of these cards could change the order at your cart’s amount.';

export default function RatesResult({
  catalog,
  result,
  merchantId,
  headingId,
}: {
  catalog: Catalog;
  result: Comparison;
  merchantId: string;
  /** Rendered as an `h3` when given (the popup); the badge panel has its own heading. */
  headingId?: string;
}) {
  const capped = ratesCapped(result, catalog);
  return (
    <div className="space-y-3">
      {headingId && (
        <h3 id={headingId} className="section-title">
          Best card by rate at {merchantName(merchantId)}
        </h3>
      )}
      <p className="supporting">
        {RATES_INTRO}
        {capped || result.rankingMayChange ? ', unless a condition below applies.' : '.'}
      </p>
      {result.rankingMayChange && <p className="supporting">{rankingNote(result, catalog)}</p>}
      {capped && <p className="supporting">{RATES_CAP_NOTE}</p>}
      <ol className="estimate-list rates-list" aria-label="Your cards by rate, best first">
        {result.estimates.map((estimate, i) => {
          const card = catalog.cards.find((c) => c.id === estimate.cardId);
          const best = i === 0 && !result.tied && !result.rankingMayChange && !capped;
          return (
            <li key={estimate.cardId} className={best ? 'rates-row rates-row--best' : 'rates-row'}>
              <span className="rates-row__name">{card?.shortName ?? estimate.cardId}</span>
              <span className="rates-row__rate">{rateWording(estimate, catalog)}</span>
            </li>
          );
        })}
      </ol>
      {notAcceptedLines(result, catalog).map((line) => (
        <p key={line} className="supporting">
          {line}
        </p>
      ))}
    </div>
  );
}
