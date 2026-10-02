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
  async function toggle(merchant: MerchantId, on: boolean) {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      setSettings(
        await saveSettings({
          ...settings,
          disabledMerchants: on
            ? settings.disabledMerchants.filter((id) => id !== merchant)
            : [...settings.disabledMerchants, merchant],
        }),
      );
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
        legend="Show the cart badge on"
        helperText="The badge reads only the cart’s order summary amount, on these sites only."
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
      </Fieldset>
    </div>
  );
}
