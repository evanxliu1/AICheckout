// All-time savings from orders the shopper confirmed in the badge: a total, the history, a JSON
// export and deletion. Every amount is an estimate and labelled as one.
import { useState } from 'react';
import { Button, Card, Checkbox, Disclosure } from '@ai-checkout/ui';
import { formatUsd } from '../domain';
import type { SavingsEntry } from '../state/contracts';
import { totalExtraCents } from '../state/savings';
import { merchantName } from '../checkout/merchants';

const signed = (cents: number) => `${cents < 0 ? '−' : ''}${formatUsd(Math.abs(cents))}`;

export default function SavingsHistory({
  entries,
  cards,
  busy,
  onDelete,
}: {
  entries: SavingsEntry[];
  /** Names of every card in the catalog in effect (the page's card index). */
  cards: { id: string; shortName: string }[];
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const name = (id: string | null) =>
    id ? (cards.find((card) => card.id === id)?.shortName ?? 'Unavailable card') : 'Not sure';
  const total = totalExtraCents(entries);
  function exportJson() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), estimates: true, orders: entries }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-checkout-savings.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Card as="section" hasBorder aria-labelledby="savings-heading">
      <div className="card-body space-y-2">
        <h2 id="savings-heading" className="section-title">
          All-time: {signed(total)} extra in rewards
        </h2>
        <p className="supporting">
          Estimated, compared with your default card, from {entries.length} order
          {entries.length === 1 ? '' : 's'} you confirmed in the cart badge. Cash back counts at face value;
          points and miles at the value in effect when the order was recorded (a published estimate, the
          issuer’s value or your own), and an order on a card whose points have no value is not counted. Cart
          amounts are the last amount the badge read; tax and shipping may differ.
        </p>
        {entries.length > 0 && (
          <>
            <Disclosure title={`Order history (${entries.length})`}>
              <ul className="plain-list space-y-2">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <strong>
                      {entry.date} · {merchantName(entry.merchantId)} · {formatUsd(entry.cartAmountCents)}{' '}
                      cart
                    </strong>
                    <br />
                    Paid with {name(entry.usedCardId)}
                    {entry.usedCardId !== entry.recommendedCardId &&
                      ` (recommended: ${name(entry.recommendedCardId)})`}
                    {entry.extraCents !== null
                      ? ` · ${signed(entry.extraCents)} vs default`
                      : ' · not counted'}
                  </li>
                ))}
              </ul>
            </Disclosure>
            <div className="flex flex-wrap gap-2">
              <Button size="small" color="secondary" disabled={busy} onClick={exportJson}>
                Export history (JSON)
              </Button>
            </div>
            <Disclosure title="Delete savings history">
              <div className="space-y-2">
                <Checkbox
                  label="I want to delete my order history and all-time total."
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <Button
                  size="small"
                  color="critical"
                  icon="trash"
                  disabled={busy || !confirmed}
                  onClick={() => {
                    setConfirmed(false);
                    onDelete();
                  }}
                >
                  Delete history
                </Button>
              </div>
            </Disclosure>
          </>
        )}
      </div>
    </Card>
  );
}
