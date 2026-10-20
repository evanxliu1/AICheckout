import { useState } from 'react';
import { AlertInline, Button, Checkbox, Disclosure } from '@ai-checkout/ui';
import { REPORTS_NOT_DELETED_MESSAGE } from '../state/telemetry-contracts';

/** Delete all local data. `keepReports` is "Clear this device anyway" after the worker could not delete the
 * usage reports stored under the identifier (Phase 15.5b). */
export type DeleteOptions = { keepReports: true };

export default function DeleteSavedData({
  busy,
  onDelete,
}: {
  busy: boolean;
  onDelete: (options?: DeleteOptions) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Disclosure title="Delete saved data" id="delete-saved-data">
      <div className="space-y-3">
        <p>
          This removes your cards, purchase inputs and saved terms from this extension. It cannot be undone.
          No passphrase is needed to delete. If you share usage reports, the reports sent under your
          identifier are deleted from the service first.
        </p>
        <Checkbox
          label="I want to permanently delete this extension’s local data."
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <Button color="critical" icon="trash" disabled={busy || !confirmed} onClick={() => onDelete()}>
          Delete all local data
        </Button>
      </div>
    </Disclosure>
  );
}

/** Shown in place of the generic error when Delete all local data stopped at the service: nothing was cleared,
 * the identifier is still on the device, and the shopper decides. */
export function ReportsNotDeleted({
  busy,
  onDelete,
}: {
  busy: boolean;
  onDelete: (options?: DeleteOptions) => void;
}) {
  return (
    <AlertInline
      color="critical"
      role="alert"
      title={REPORTS_NOT_DELETED_MESSAGE}
      actions={
        <>
          <Button size="small" color="secondary" disabled={busy} onClick={() => onDelete()}>
            Try again
          </Button>
          <Button
            size="small"
            color="critical"
            icon="trash"
            disabled={busy}
            onClick={() => onDelete({ keepReports: true })}
          >
            Clear this device anyway
          </Button>
        </>
      }
    >
      Clearing anyway keeps the reports already sent; they expire after 90 days.
    </AlertInline>
  );
}
