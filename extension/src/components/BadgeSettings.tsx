// Per-site switch for the automatic cart badge.
import { useEffect, useState } from 'react';
import { AlertInline, Fieldset, Toggle } from '@ai-checkout/ui';
import { MERCHANT_IDS, merchantName, type MerchantId } from '../checkout/merchants';
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
  const toggle = (merchant: MerchantId, on: boolean) =>
    settings &&
    save({
      ...settings,
      disabledMerchants: on
        ? settings.disabledMerchants.filter((id) => id !== merchant)
        : [...settings.disabledMerchants, merchant],
    });
  return (
    <div className="space-y-2">
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      <Fieldset
        legend="Show the cart badge on"
        helperText="On a cart or checkout page the badge reads only the order summary amount; nothing about the page leaves your device."
      >
        {MERCHANT_IDS.map((merchant) => (
          <Toggle
            key={merchant}
            label={merchantName(merchant)}
            checked={!!settings && !settings.disabledMerchants.includes(merchant)}
            disabled={busy || !settings}
            onChange={(event) => void toggle(merchant, event.target.checked)}
          />
        ))}
        <Toggle
          label="Show the badge at other stores"
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
