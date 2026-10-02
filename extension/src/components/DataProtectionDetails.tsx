import { Disclosure } from '@ai-checkout/ui';

export default function DataProtectionDetails({
  protection = 'off',
  locked = false,
}: {
  protection?: 'off' | 'on' | 'damaged';
  locked?: boolean;
}) {
  const how =
    protection === 'damaged'
      ? 'The saved record could not be validated, so its protection cannot be confirmed.'
      : protection === 'on'
        ? `Card selections, reported reward limits, purchase inputs, cart identifiers and savings history are encrypted with your passphrase in this Chrome profile.${locked ? ' They stay encrypted until you unlock them for this browser session.' : ''}`
        : 'Card selections, reported reward limits, purchase inputs, cart identifiers and savings history are saved in this Chrome profile, readable only by this extension. Turn on passphrase protection in Settings to encrypt them.';
  return (
    <Disclosure title="Data and protection details">
      <p>
        {how} Nothing is sent to an AI provider or to us. On Amazon US, Best Buy US and Newegg US carts the
        extension reads the order summary amount automatically to show the cart badge; it saves amount
        metadata, never product names, addresses or payment fields. Order completion is recognized from the
        page address only.
      </p>
      <p className="mt-2">
        Freshness limits stop stale comparisons; they do not automatically erase saved inputs. With protection
        on, the unlock key stays in Chrome’s session memory until you lock, restart Chrome, or reload the
        extension; while unlocked, someone using your Chrome profile can see these inputs. Encryption does not
        protect against an already compromised device.
      </p>
      <p className="mt-2">
        Delete all local data clears this extension’s inputs, settings, savings and unlock key. It does not
        clear merchant carts, browser history or external backups. Card-source links open issuer websites;
        optional term updates, when configured, contact the catalog service without your purchase inputs.
      </p>
    </Disclosure>
  );
}
