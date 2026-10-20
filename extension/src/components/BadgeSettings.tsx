// The automatic cart badge's switches: on or off everywhere, and back on for a site switched off.
import { useEffect, useState } from 'react';
import { AlertInline, Fieldset, Toggle } from '@ai-checkout/ui';
import type { Settings } from '../badge/contracts';
import { getSettings, saveSettings } from '../state/settings-client';

export default function BadgeSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Settings could not be loaded.'));
  }, []);
  async function save(next: Settings) {
    setBusy(true);
    setError('');
    try {
      setSettings(await saveSettings(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      <Fieldset
        legend="Cart badge"
        helperText="On a cart or checkout page the badge reads only the order summary amount; nothing about the page leaves your device. Sites you switched off with “Not on this site” are listed below."
      >
        <Toggle
          label="Show the cart badge at stores"
          checked={!!settings && settings.showOnOtherStores}
          disabled={busy || !settings}
          onChange={(event) =>
            settings && void save({ ...settings, showOnOtherStores: event.target.checked })
          }
        />
        {settings?.disabledSites.map((site) => (
          <Toggle
            key={site}
            label={site}
            checked={false}
            disabled={busy}
            onChange={() =>
              void save({ ...settings, disabledSites: settings.disabledSites.filter((s) => s !== site) })
            }
          />
        ))}
      </Fieldset>
    </div>
  );
}
