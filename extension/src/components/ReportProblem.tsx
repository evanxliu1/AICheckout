// "Report a problem" (Phase 15.3): a fixed reason, no free text (decision 2026-10-19). The worker sends the
// tab's registrable domain, the reason and what the badge showed there, with the random identifier only while
// sharing is on. Works for shoppers who chose Not now.
import { useState } from 'react';
import { AlertInline, Button, Disclosure, Field, Select } from '@ai-checkout/ui';
import { telemetryRequest } from '../state/telemetry-client';
import { PROBLEM_REASONS } from '../state/telemetry-contracts';
import type { ProblemReason } from '../state/telemetry-contracts';

export default function ReportProblem({ tabId }: { tabId: number | null }) {
  const [reason, setReason] = useState<ProblemReason>('wrong-amount');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  async function send() {
    if (tabId === null) return;
    setState('busy');
    setError('');
    try {
      await telemetryRequest({ type: 'telemetry:report-problem', tabId, reason });
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be sent.');
      setState('idle');
    }
  }
  return (
    <Disclosure title="Report a problem" id="report-problem">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p>
          Pick what went wrong on this page. The report carries the store’s domain (for example example.com),
          the reason and what the badge showed (an amount or not), plus your random identifier only if you
          share usage reports. There is no text field, so no order details or personal information can be
          sent.
        </p>
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        {state === 'sent' ? (
          <AlertInline role="status">Thanks. Your report was sent.</AlertInline>
        ) : (
          <>
            <Field id="problem-reason" label="What went wrong">
              {(control) => (
                <Select
                  {...control}
                  value={reason}
                  disabled={state === 'busy' || tabId === null}
                  onChange={(event) => setReason(event.target.value as ProblemReason)}
                >
                  {Object.entries(PROBLEM_REASONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {tabId === null && (
              <p className="supporting">Open AI Checkout from a store’s page to report a problem there.</p>
            )}
            <Button
              type="submit"
              size="small"
              color="secondary"
              isLoading={state === 'busy'}
              disabled={tabId === null}
            >
              Send report
            </Button>
          </>
        )}
      </form>
    </Disclosure>
  );
}
