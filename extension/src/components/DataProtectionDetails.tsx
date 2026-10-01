import { Disclosure } from '@ai-checkout/ui';
import type { VaultStatus } from '../state/vault-contracts';

export default function DataProtectionDetails({ status = 'unlocked' }: { status?: VaultStatus }) {
  const protection =
    status === 'setup'
      ? 'After you choose a passphrase and accept setup, your card selections, reported reward limits, purchase inputs and cart identifiers will be encrypted in this Chrome profile.'
      : status === 'migration'
        ? 'Your earlier saved inputs are still unencrypted. Protecting them below will encrypt the active record containing your card selections, reported reward limits, purchase inputs and cart identifiers.'
        : status === 'damaged'
          ? 'The saved record could not be validated, so its protection cannot be confirmed. New inputs are encrypted only after setup.'
          : 'Card selections, reported reward limits, purchase inputs and cart identifiers are encrypted in this Chrome profile.';
  return (
    <Disclosure title="Data and protection details">
      <p>
        {protection} These inputs are not sent to an AI provider. Cart reading uses the chosen tab’s address
        temporarily and saves amount metadata and a page-identity hash, without saving the full address,
        product names or payment fields.
      </p>
      <p className="mt-2">
        Freshness limits stop stale comparisons; they do not automatically erase all saved inputs. The unlock
        key stays in Chrome’s session memory until you lock, restart Chrome, or reload the extension. While
        unlocked, someone using your Chrome profile can see these inputs. Encryption does not protect against
        an already compromised device or copies made before protection was enabled.
      </p>
      <p className="mt-2">
        Delete all local data clears this extension’s inputs and unlock key. It does not clear merchant carts,
        browser history or external backups. Card-source links open issuer websites; optional term updates,
        when configured, contact the catalog service without your purchase inputs.
      </p>
    </Disclosure>
  );
}
