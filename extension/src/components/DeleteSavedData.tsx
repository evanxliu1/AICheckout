import { useState } from 'react';

export default function DeleteSavedData({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <details className="supporting mt-4" id="delete-saved-data">
    <summary className="cursor-pointer underline text-red-800">Delete saved data</summary>
    <p className="mt-2">This removes your cards, purchase inputs and saved terms from this extension. It cannot be undone. No passphrase is needed to delete.</p>
    <label className="flex items-start gap-3 mt-3">
      <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
      <span>I want to permanently delete this extension’s local data.</span>
    </label>
    <button className="text-red-800 underline mt-3" disabled={busy || !confirmed} onClick={onDelete}>Delete all local data</button>
  </details>;
}
