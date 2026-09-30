import {
  ACTIVATION_LABELS,
  type Catalog,
  type RewardRule,
  type RewardRuleV2,
  type RuleCap,
} from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';

export interface ChangeRow {
  key: string;
  label: string;
  before: string;
  after: string;
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const percent = (bps: number) => `${bps / 100}%`;

function capText(cap: RuleCap) {
  if (cap.kind === 'none') return 'No cap';
  if (cap.kind === 'unstated') return 'Not stated by the issuer';
  return `${money(cap.amountCents)} per ${cap.period}, then ${percent(cap.rateAfterCapBps)}`;
}

function fields(catalog: Catalog | null) {
  const values = new Map<string, { label: string; value: string }>();
  if (!catalog) return values;
  const add = (key: string, label: string, value: string | number) =>
    values.set(key, { label, value: String(value) });
  add('schemaVersion', 'Catalog schema', catalog.schemaVersion);
  add('version', 'Catalog version', catalog.version);
  add('verifiedAt', 'Verified at (UTC)', catalog.verifiedAt);
  add('expiresAt', 'Terms expire at (UTC)', catalog.expiresAt);
  if (catalog.schemaVersion === 1) {
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
        add(`${key}.rate`, `${label} · Reward rate`, percent(rule.rateBps));
        add(
          `${key}.cap`,
          `${label} · Annual spend cap`,
          rule.annualCapCents === undefined ? 'No cap modeled' : money(rule.annualCapCents),
        );
        add(
          `${key}.activation`,
          `${label} · Activation`,
          rule.requiresActivation ? 'Required' : 'Not required',
        );
        add(`${key}.sources`, `${label} · Evidence references`, [...rule.sourceIds].sort().join(', '));
      }
    }
  } else {
    add(
      'merchants',
      'Supported merchants',
      catalog.merchants
        .map((m) => m.id)
        .sort()
        .join(', '),
    );
    for (const merchant of catalog.merchants) {
      const key = `merchants.${merchant.id}`,
        label = `${merchant.name} (merchant)`;
      add(`${key}.name`, `${label} · Name`, merchant.name);
      add(
        `${key}.profile`,
        `${label} · Profile`,
        [
          merchant.onlineRetail ? 'online retail' : 'not online retail',
          merchant.physicalGoods ? 'physical goods' : 'no physical goods',
          merchant.usMerchant ? 'U.S. merchant' : 'non-U.S. merchant',
          `expected category ${merchant.expectedCategory}`,
        ].join(', '),
      );
      add(
        `${key}.mcc`,
        `${label} · Expected MCC`,
        `${merchant.mcc.code ?? 'unknown'} (${merchant.mcc.confidence} confidence; ${
          [...merchant.mcc.sourceIds].sort().join(', ') || 'no sources'
        })`,
      );
      add(`${key}.notes`, `${label} · Notes`, merchant.notes);
    }
    for (const card of catalog.cards) {
      const prefix = `cards.${card.id}`;
      add(`${prefix}.name`, `${card.id} · Card name`, card.name);
      add(`${prefix}.shortName`, `${card.id} · Short name`, card.shortName);
      add(`${prefix}.issuer`, `${card.id} · Issuer`, card.issuer);
      add(
        `${prefix}.currency`,
        `${card.id} · Reward currency`,
        card.rewardCurrency === 'points'
          ? `Points worth ${card.pointValueHundredthsOfCent! / 100}¢ each`
          : 'Cash back',
      );
      add(
        `${prefix}.exclusions`,
        `${card.id} · Exclusions`,
        [...card.exclusions].sort().join(' | ') || 'None',
      );
      for (const rule of card.rules) {
        const key = `${prefix}.${rule.id}`,
          label = `${card.shortName} · ${rule.id}`;
        add(`${key}.category`, `${label} · Category`, rule.category);
        add(`${key}.wording`, `${label} · Issuer wording`, rule.issuerWording);
        add(`${key}.rate`, `${label} · Reward rate`, percent(rule.rateBps));
        add(
          `${key}.paidOnPayment`,
          `${label} · Paid when the balance is paid`,
          rule.paidOnPaymentBps ? percent(rule.paidOnPaymentBps) : 'None',
        );
        add(`${key}.cap`, `${label} · Spend cap`, capText(rule.cap));
        add(`${key}.activation`, `${label} · Activation`, rule.activation);
        add(`${key}.usOnly`, `${label} · U.S. merchants only`, rule.usMerchantsOnly ? 'Yes' : 'No');
        add(
          `${key}.limitedTime`,
          `${label} · Limited time`,
          rule.limitedTime ? `Ends ${rule.limitedTime.endsOn ?? 'on an unstated date'}` : 'No',
        );
        add(
          `${key}.excludedPaymentPaths`,
          `${label} · Excluded payment paths`,
          [...rule.excludedPaymentPaths].sort().join(', ') || 'None',
        );
        add(`${key}.sources`, `${label} · Evidence references`, [...rule.sourceIds].sort().join(', '));
      }
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

/** One line per rule for the full-draft summary, for either schema version. */
export function ruleSummaries(rules: RewardRule[] | RewardRuleV2[]) {
  return rules.map((rule) => {
    if ('requiresActivation' in rule) {
      return {
        rule,
        title: `${percent(rule.rateBps)} · ${rule.category === 'all-eligible' ? 'All eligible purchases' : 'US online retail'}`,
        conditions: `${
          rule.annualCapCents === undefined
            ? 'No annual spend cap modeled.'
            : `Annual spend cap: ${money(rule.annualCapCents)}.`
        } ${rule.requiresActivation ? 'Activation required.' : 'No activation required.'}`,
      };
    }
    const conditions = [
      `Cap: ${capText(rule.cap)}.`,
      `${ACTIVATION_LABELS[rule.activation]}.`,
      rule.paidOnPaymentBps ? `${percent(rule.paidOnPaymentBps)} is paid when the balance is paid.` : '',
      rule.usMerchantsOnly ? 'U.S. merchants only.' : '',
      rule.limitedTime ? `Limited time, ends ${rule.limitedTime.endsOn ?? 'on an unstated date'}.` : '',
      rule.excludedPaymentPaths.length ? `Excludes ${rule.excludedPaymentPaths.join(', ')}.` : '',
    ].filter(Boolean);
    return {
      rule,
      title: `${percent(rule.rateBps)} · ${rule.category} · “${rule.issuerWording}”`,
      conditions: conditions.join(' '),
    };
  });
}
