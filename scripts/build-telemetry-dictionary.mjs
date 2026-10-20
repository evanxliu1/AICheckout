// Generates the public event dictionary docs/telemetry/events.md from the telemetry contract (Phase 15.3):
// the Zod schemas in packages/catalog-review/src/telemetry.ts and their `.describe()` texts, rendered through
// their JSON Schema form, plus a fixed note per event type saying when the extension sends it. The dictionary
// cannot drift from the code: `--check` fails in CI when the committed file is stale.
//
//   node scripts/build-telemetry-dictionary.mjs            write docs/telemetry/events.md
//   node scripts/build-telemetry-dictionary.mjs --check    fail if the committed file is stale (CI)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import {
  TAP_EVENT_TYPES,
  TELEMETRY_EVENT_TYPES,
  TELEMETRY_LIMITS,
  telemetryEventSchema,
} from '../packages/catalog-review/src/telemetry.ts';

const { values: args } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
const root = new URL('../', import.meta.url);
const out = new URL('docs/telemetry/events.md', root);

/** When the extension sends each event (wiki/product/phase-15-release-a.md §5; the worker's emit points). */
const WHEN = {
  consent_granted:
    'Once, when the shopper chooses Share on the onboarding consent screen or turns sharing back on in Settings; queued first, so it doubles as the install event. Stop sharing and Delete my data clear the identifier; a later Share mints a new one and sends this again.',
  onboarding_completed: 'Once, with `consent_granted`, when Share is chosen on the onboarding screen.',
  wallet_changed:
    'With `consent_granted` (the cards owned when sharing starts) and on every save of the card list in the popup.',
  recommendation_shown:
    'Once per distinct recommendation in a tab (the reading, store, payment path and top card) when the badge shows the amount or rates view, and in the popup when a read cart is compared or the rates view is shown. A comparison of an amount the shopper typed is not reported (nothing was read).',
  badge_expanded: 'Each time the badge panel is opened.',
  badge_dismissed: 'Each time "Dismiss for this tab" is chosen.',
  site_disabled: 'Each time "Not on this site" is chosen; the host stays on the device.',
  amount_typed: 'Each time an amount is typed into the badge panel.',
  popup_opened:
    'When the popup opens on a tab and reads it (or cannot: a payment page, a non-web tab). Not sent when the popup opens with no cards, or keeps a cart already read or compared in that tab.',
  release_refresh:
    'Per release checked by the weekly alarm (`weekly`, with its retry) and for the card catalog on "Check for updated terms" (`manual`).',
  error: 'Per caught request failure in the worker, at most 20 a day.',
  store_suggested:
    'On the shopper’s tap on "Suggest this store" (popup) or "Store not recognised? Suggest it" (badge panel), at a store the merchant release does not name. Sent whether sharing is on or not; `install_id` is null when it is off.',
  problem_reported:
    'On the shopper’s tap on "Send report" under "Report a problem" in the popup, with one of the fixed reasons; there is no free text. Sent whether sharing is on or not; `install_id` is null when it is off.',
};
for (const type of TELEMETRY_EVENT_TYPES) if (!WHEN[type]) throw new Error(`No note for ${type}`);

const schema = z.toJSONSchema(telemetryEventSchema);
const variants = schema.oneOf;
const byType = new Map(variants.map((variant) => [variant.properties.type.const, variant]));
// A pipe inside a pattern would end the table cell.
const code = (text) => `\`${String(text).replaceAll('|', '\\|')}\``;
const pattern = (field) => {
  const patterns = [field.pattern, ...(field.allOf ?? []).map((part) => part.pattern)].filter(Boolean);
  // The ISO timestamp pattern is long; name it instead.
  if (field.description?.startsWith('When the extension built')) return 'ISO 8601 timestamp in UTC (`Z`)';
  return patterns.length ? `matching ${patterns.map((p) => code(p)).join(' and ')}` : '';
};
/** A field's type in words, from its JSON Schema. */
function typeOf(field) {
  if (field.anyOf) {
    const nullable = field.anyOf.some((part) => part.type === 'null');
    const rest = field.anyOf.filter((part) => part.type !== 'null').map(typeOf);
    return nullable ? `${rest.join(' or ')}, or null` : rest.join(' or ');
  }
  if (field.enum) return `one of ${field.enum.map(code).join(', ')}`;
  if (field.const !== undefined) return `always ${code(JSON.stringify(field.const))}`;
  if (field.type === 'array') {
    const max = field.maxItems !== undefined ? `, at most ${field.maxItems}` : '';
    return `array of ${typeOf(field.items)}${max}`;
  }
  if (field.type === 'string') {
    if (field.format === 'uuid') return 'UUID v4';
    const parts = ['string'];
    if (field.maxLength !== undefined) parts.push(`of at most ${field.maxLength} characters`);
    const matching = pattern(field);
    if (matching) parts.push(matching);
    return parts.join(' ');
  }
  if (field.type === 'integer' || field.type === 'number') {
    const kind = field.type === 'integer' ? 'integer' : 'number';
    const range =
      field.minimum !== undefined && field.maximum !== undefined
        ? ` from ${field.minimum.toLocaleString('en-US')} to ${field.maximum.toLocaleString('en-US')}`
        : field.minimum !== undefined
          ? ` of at least ${field.minimum}`
          : '';
    return `${kind}${range}`;
  }
  if (field.type === 'boolean') return 'boolean';
  return field.type ?? 'value';
}
const describe = (field) => field.description ?? '';
const row = (name, field) => `| ${code(name)} | ${typeOf(field)} | ${describe(field)} |`;
const table = (rows) => ['| Field | Type | Meaning |', '| --- | --- | --- |', ...rows].join('\n');

// The envelope: every field present on every event, described once from the first automatic event.
const first = byType.get(TELEMETRY_EVENT_TYPES[0]);
const envelopeKeys = Object.keys(first.properties).filter(
  (key) => key !== 'type' && variants.every((variant) => key in variant.properties),
);
const tapTypes = new Set(TAP_EVENT_TYPES);
const envelopeRows = envelopeKeys.map((key) => {
  if (key !== 'install_id') return row(key, first.properties[key]);
  const tap = byType.get(TAP_EVENT_TYPES[0]).properties.install_id;
  return `| ${code(key)} | UUID v4 on automatic events; UUID v4 or null on ${[...tapTypes].map(code).join(' and ')} | ${describe(first.properties[key])}. ${describe(tap).replace(/^The random identifier, or /, 'On the two tap events ')} |`;
});
const sections = TELEMETRY_EVENT_TYPES.map((type) => {
  const variant = byType.get(type);
  const own = Object.keys(variant.properties).filter((key) => key !== 'type' && !envelopeKeys.includes(key));
  const tap = tapTypes.has(type) ? ' (shopper-initiated; may carry no identifier)' : '';
  return [
    `### ${code(type)}${tap}`,
    '',
    `**When:** ${WHEN[type]}`,
    '',
    own.length
      ? table(own.map((key) => row(key, variant.properties[key])))
      : '_No fields beyond the envelope._',
  ].join('\n');
});
const limits = TELEMETRY_LIMITS;
const text = `# AI Checkout usage report dictionary

Generated from the telemetry contract (\`packages/catalog-review/src/telemetry.ts\`, schema version 1) by \`npm run telemetry\`; \`npm run telemetry:check\` fails in CI when this file is stale. Do not edit by hand.

AI Checkout sends usage reports only after the shopper chooses **Share** on the onboarding screen (or turns sharing on in Settings), and only in builds made with usage reporting on. Every report carries the envelope below under a **random identifier**: no name, email or browsing history. The identifier is created when sharing starts and cleared by **Stop sharing** and **Delete my data**; a later Share creates a new one. The two shopper-initiated events (${[...tapTypes].map(code).join(', ')}) are sent on the shopper's own tap whether sharing is on or not, and carry no identifier when it is off.

**No automatic event carries a store name, domain, web address, page text or card number.** A store's registrable domain travels only on the two tap events. Amounts are integer cents. Raw reports are kept for ${limits.retentionDays} days; the service stores at most ${limits.installDay} events per identifier per day and ${limits.globalDay.toLocaleString('en-US')} per day in all, and accepts batches of at most ${limits.batchEvents} events and ${limits.batchBytes.toLocaleString('en-US')} bytes. The extension keeps at most 200 unsent events on the device and sends them every 15 minutes while any wait, or at once when 50 are waiting, at consent and on each tap.

## Envelope (every event)

${table(envelopeRows)}

## Events

${sections.join('\n\n')}

## Not sent in this release

Reserved names, never emitted by this version: \`offer_impression\`, \`offer_click\`, \`opportunity\`. Stop sharing sends nothing (the queue and the identifier are cleared on the device); Delete my data is a request to the service (\`POST /v1/events/delete\` with the current identifier), not an event.
`;
const formatted = await format(text, { ...(await resolveConfig(out.pathname)), filepath: out.pathname });

if (args.check) {
  let current = null;
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    current = null;
  }
  if (current !== formatted) {
    console.error(`Stale: docs/telemetry/events.md. Run \`npm run telemetry\`.`);
    process.exit(1);
  }
  console.log(`docs/telemetry/events.md is up to date (${TELEMETRY_EVENT_TYPES.length} event types).`);
} else {
  mkdirSync(new URL('docs/telemetry/', root), { recursive: true });
  writeFileSync(out, formatted);
  console.log(`Wrote docs/telemetry/events.md (${TELEMETRY_EVENT_TYPES.length} event types).`);
}
