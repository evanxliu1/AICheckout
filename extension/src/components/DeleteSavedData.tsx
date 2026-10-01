import { useState } from 'react';
import { Button, Checkbox, Disclosure } from '@ai-checkout/ui';

export default function DeleteSavedData({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Disclosure title="Delete saved data" id="delete-saved-data">
      <div className="space-y-3">
        <p>
          This removes your cards, purchase inputs and saved terms from this extension. It cannot be undone.
          No passphrase is needed to delete.
        </p>
        <Checkbox
          label="I want to permanently delete this extension’s local data."
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <Button color="critical" icon="trash" disabled={busy || !confirmed} onClick={onDelete}>
          Delete all local data
        </Button>
      </div>
    </Disclosure>
  );
}
