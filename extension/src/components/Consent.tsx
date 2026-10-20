// The one consent question (Phase 15.3, decisions 2026-10-10 and 2026-10-19): shown once in onboarding after
// the cards are saved, Share and Not now equally prominent. The copy is `CONSENT_COPY`, which the dictionary
// agreement test checks against the event types. Nothing leaves the device before Share.
import { AlertInline, Button, Card, Link } from '@ai-checkout/ui';
import { CONSENT_COPY, PRIVACY_POLICY_URL } from '../state/telemetry-contracts';

export default function Consent({
  busy,
  error,
  onAnswer,
}: {
  busy: boolean;
  error?: string;
  onAnswer: (granted: boolean) => void;
}) {
  return (
    <Card as="section" hasBorder aria-labelledby="consent-heading">
      <div className="card-body space-y-3">
        <h2 id="consent-heading" tabIndex={-1} className="section-title">
          {CONSENT_COPY.title}
        </h2>
        <p>{CONSENT_COPY.lead}</p>
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        <h3 id="consent-sent" className="supporting font-semibold">
          {CONSENT_COPY.sentHeading}
        </h3>
        <ul className="consent-list" aria-labelledby="consent-sent">
          {CONSENT_COPY.sent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="supporting">{CONSENT_COPY.never}</p>
        <p className="supporting">
          {CONSENT_COPY.retention}
          {PRIVACY_POLICY_URL && (
            <>
              {' '}
              <Link href={PRIVACY_POLICY_URL} isExternal>
                {CONSENT_COPY.policy}
              </Link>
            </>
          )}
        </p>
        <div className="consent-actions">
          <Button color="secondary" disabled={busy} onClick={() => onAnswer(true)}>
            {CONSENT_COPY.share}
          </Button>
          <Button color="secondary" disabled={busy} onClick={() => onAnswer(false)}>
            {CONSENT_COPY.notNow}
          </Button>
        </div>
      </div>
    </Card>
  );
}
