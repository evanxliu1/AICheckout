import type { Catalog } from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';

export interface ChangeRow {
  key: string;
  label: string;
  before: string;
  after: string;
}
function fields(catalog: Catalog | null) {
  const values = new Map<string, { label: string; value: string }>();
  if (!catalog) return values;
  const add = (key: string, label: string, value: string | number) =>
    values.set(key, { label, value: String(value) });
  add('version', 'Catalog version', catalog.version);
  add('verifiedAt', 'Verified at (UTC)', catalog.verifiedAt);
  add('expiresAt', 'Terms expire at (UTC)', catalog.expiresAt);
  add('merchants', 'Supported merchants', [...catalog.merchantIds].sort().join(', '));
  for (const card of catalog.cards) {
    const prefix = `cards.${card.id}`;
    add(`${prefix}.name`, `${card.id} · Card name`, card.name);
    add(`${prefix}.shortName`, `${card.id} · Short name`, card.shortName);
    for (const rule of card.rules) {
      const key = `${prefix}.${rule.id}`,
        label = `${card.shortName} · ${rule.id}`;
      add(
        `${key}.category`,
        `${label} · Category`,
        rule.category === 'all-eligible' ? 'All eligible purchases' : 'US online retail',
      );
      add(`${key}.rate`, `${label} · Reward rate`, `${rule.rateBps / 100}%`);
      add(
        `${key}.cap`,
        `${label} · Annual spend cap`,
        rule.annualCapCents === undefined
          ? 'No cap modeled'
          : `$${(rule.annualCapCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );
      add(
        `${key}.activation`,
        `${label} · Activation`,
        rule.requiresActivation ? 'Required' : 'Not required',
      );
      add(`${key}.sources`, `${label} · Evidence references`, [...rule.sourceIds].sort().join(', '));
    }
  }
  for (const source of catalog.sources) {
    const key = `sources.${source.id}`;
    add(`${key}.title`, `${source.id} · Source title`, source.title);
    add(`${key}.url`, `${source.id} · Source URL`, source.url);
    add(`${key}.checkedOn`, `${source.id} · Checked on`, source.checkedOn);
  }
  return values;
}
export function catalogChanges(before: Catalog | null, after: Catalog): ChangeRow[] {
  const oldFields = fields(before),
    newFields = fields(after);
  return [...new Set([...newFields.keys(), ...oldFields.keys()])].flatMap((key) => {
    const old = oldFields.get(key),
      next = newFields.get(key);
    return old?.value === next?.value
      ? []
      : [
          {
            key,
            label: next?.label ?? old!.label,
            before: old?.value ?? 'Not present',
            after: next?.value ?? 'Removed',
          },
        ];
  });
}
export function publicationIssues(detail: ReviewDetail, now: number): string[] {
  const { draft, published, head, sources } = detail,
    issues: string[] = [];
  if (draft.status !== 'draft')
    issues.push('This draft has already been reviewed and cannot be published again here.');
  if (draft.base_sequence !== head)
    issues.push('Published terms changed. Rebase this draft, then review the new comparison.');
  if (published?.version === draft.catalog.version && draft.status === 'draft')
    issues.push('Choose a new catalog version before publication.');
  if (Date.parse(draft.catalog.verifiedAt) > now) issues.push('The verification time is in the future.');
  if (Date.parse(draft.catalog.expiresAt) <= now)
    issues.push(
      'These terms expired. Check the issuer terms and update their verification dates before publishing.',
    );
  if (
    sources.length !== draft.catalog.sources.length ||
    draft.catalog.sources.some(
      (source) =>
        !sources.some(
          (doc) =>
            doc.source_key === source.id &&
            doc.title === source.title &&
            doc.url === source.url &&
            doc.checked_on === source.checkedOn,
        ),
    )
  ) {
    issues.push('Capture matching evidence for every source before publication.');
  }
  return issues;
}
