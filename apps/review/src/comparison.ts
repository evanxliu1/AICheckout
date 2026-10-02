import {
  ACTIVATION_LABELS,
  type Catalog,
  type RewardProgram,
  type RewardRule,
  type RewardRuleV2,
  type RewardRuleV3,
  type RuleCap,
} from '@ai-checkout/rewards-core';
import type { ReviewSummary } from '@ai-checkout/catalog-review';

export interface ChangeRow {
  key: string;
  label: string;
  before: string;
  after: string;
  /** Section the field belongs to: `catalog`, `merchants`, `programs`, `brands`, `gates`,
   * `sources` or `cards.<card id>`, so a large diff can be shown one card at a time. */
  group: string;
  groupLabel: string;
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const percent = (bps: number) => `${bps / 100}%`;
const cents = (hundredths: number) => `${hundredths / 100}¢`;
const list = (values: string[], empty: string) => [...values].sort().join(', ') || empty;

function capText(cap: RuleCap) {
  if (cap.kind === 'none') return 'No cap';
  if (cap.kind === 'unstated') return 'Not stated by the issuer';
  return `${money(cap.amountCents)} per ${cap.period}, then ${percent(cap.rateAfterCapBps)}`;
}
function limitedText(limited: RewardRuleV2['limitedTime'] | RewardRuleV3['limitedTime']) {
  if (!limited) return 'No';
  const starts = 'startsOn' in limited && limited.startsOn ? `Starts ${limited.startsOn}; ends` : 'Ends';
  return `${starts} ${limited.endsOn ?? 'on an unstated date'}`;
}
/** Plain-words value of a program's units; published estimates are labelled as opinions. */
export function valuationText(program: RewardProgram) {
  const { valuation } = program;
  if (valuation.basis === 'cash') return 'Cash back: each unit is 1¢';
  if (valuation.basis === 'published-estimate')
    return `Published estimate ${cents(valuation.valueHundredthsOfCent)} each, by ${valuation.publisher}, read ${valuation.retrievedOn} (${valuation.url})`;
  if (valuation.basis === 'issuer-stated')
    return `Issuer-stated ${cents(valuation.valueHundredthsOfCent)} each (${list(valuation.sourceIds, 'no sources')})`;
  return 'No value: shown in units until the shopper sets one';
}
const requiresText = (rule: RewardRuleV3) =>
  rule.requires
    .map((requirement) => `${requirement.gateId} is ${[...requirement.optionIds].sort().join(' or ')}`)
    .sort()
    .join('; ') || 'None';
const choiceText = (rule: RewardRuleV3) =>
  rule.choice ? `While ${rule.choice.choiceId} is ${rule.choice.optionId}` : 'Not tied to a choice';

function fields(catalog: Catalog | null) {
  const values = new Map<string, { label: string; value: string; group: string; groupLabel: string }>();
  if (!catalog) return values;
  let group = 'catalog',
    groupLabel = 'Catalog';
  const section = (id: string, label: string) => {
    group = id;
    groupLabel = label;
  };
  const add = (key: string, label: string, value: string | number) =>
    values.set(key, { label, value: String(value), group, groupLabel });
  add('schemaVersion', 'Catalog schema', catalog.schemaVersion);
  add('version', 'Catalog version', catalog.version);
  add('verifiedAt', 'Verified at (UTC)', catalog.verifiedAt);
  add('expiresAt', 'Terms expire at (UTC)', catalog.expiresAt);
  if (catalog.schemaVersion === 1) {
    add('merchants', 'Supported merchants', [...catalog.merchantIds].sort().join(', '));
    for (const card of catalog.cards) {
      const prefix = `cards.${card.id}`;
      section(prefix, card.name);
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
    section('merchants', 'Merchants');
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
      if ('brandIds' in merchant) add(`${key}.brands`, `${label} · Brands`, list(merchant.brandIds, 'None'));
    }
    if (catalog.schemaVersion === 3) {
      section('programs', 'Reward programs');
      for (const program of catalog.programs) {
        const key = `programs.${program.id}`,
          label = `${program.id} (program)`;
        add(`${key}.name`, `${label} · Name`, program.name);
        add(
          `${key}.currency`,
          `${label} · Units`,
          program.currency === 'cash-back'
            ? `Cash back (${program.unitName})`
            : `Points (${program.unitName})`,
        );
        add(`${key}.valuation`, `${label} · Value per unit`, valuationText(program));
        add(
          `${key}.redemption`,
          `${label} · Redeemable only at`,
          list(program.redemptionBrandIds, 'Not limited to a store'),
        );
      }
      section('brands', 'Brands');
      for (const brand of catalog.brands)
        add(`brands.${brand.id}.name`, `${brand.id} (brand) · Name`, brand.name);
      section('gates', 'Membership and tier questions');
      for (const gate of catalog.gates) {
        add(`gates.${gate.id}.question`, `${gate.id} (question) · Question`, gate.question);
        add(
          `gates.${gate.id}.options`,
          `${gate.id} (question) · Answers`,
          gate.options.map((option) => `${option.id}: ${option.label}`).join(' | '),
        );
      }
    }
    for (const card of catalog.cards) {
      const prefix = `cards.${card.id}`;
      section(prefix, card.name);
      add(`${prefix}.name`, `${card.id} · Card name`, card.name);
      add(`${prefix}.shortName`, `${card.id} · Short name`, card.shortName);
      add(`${prefix}.issuer`, `${card.id} · Issuer`, card.issuer);
      add(
        `${prefix}.currency`,
        `${card.id} · Reward currency`,
        'programId' in card
          ? `Program ${card.programId}${
              card.statedValueHundredthsOfCent === null
                ? ''
                : `, issuer-stated ${card.statedValueHundredthsOfCent / 100}¢ each`
            }`
          : card.rewardCurrency === 'points'
            ? `Points worth ${card.pointValueHundredthsOfCent! / 100}¢ each`
            : 'Cash back',
      );
      if ('acceptance' in card) {
        add(
          `${prefix}.acceptance`,
          `${card.id} · Accepted at`,
          card.acceptance.kind === 'open-loop'
            ? 'Any merchant (open loop)'
            : `Only brands ${list(card.acceptance.brandIds, 'none')} (closed loop)`,
        );
        for (const choice of card.choices)
          add(
            `${prefix}.choices.${choice.id}`,
            `${card.id} · Choice ${choice.id}`,
            `${choice.label}: ${choice.kind === 'chosen' ? 'cardholder picks' : 'issuer picks by spend'} ${choice.picks} of ${choice.options
              .map((option) => `${option.id} (${option.label})`)
              .join(', ')}; default ${list(choice.defaultOptionIds, 'none')}`,
          );
      }
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
        add(`${key}.limitedTime`, `${label} · Limited time`, limitedText(rule.limitedTime));
        add(
          `${key}.excludedPaymentPaths`,
          `${label} · Excluded payment paths`,
          [...rule.excludedPaymentPaths].sort().join(', ') || 'None',
        );
        if ('brandIds' in rule) {
          add(`${key}.brands`, `${label} · Only at brands`, list(rule.brandIds, 'Any merchant'));
          add(`${key}.excludedBrands`, `${label} · Never at brands`, list(rule.excludedBrandIds, 'None'));
          add(`${key}.sharedCap`, `${label} · Shared spend cap`, rule.sharedCapId ?? 'Not shared');
          add(`${key}.choice`, `${label} · Chosen category`, choiceText(rule));
          add(`${key}.requires`, `${label} · Requires`, requiresText(rule));
          add(
            `${key}.requiredPaymentPaths`,
            `${label} · Only when paying with`,
            list(rule.requiredPaymentPaths, 'Any payment path'),
          );
        }
        add(`${key}.sources`, `${label} · Evidence references`, [...rule.sourceIds].sort().join(', '));
      }
    }
  }
  section('sources', 'Sources');
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
            group: next?.group ?? old!.group,
            groupLabel: next?.groupLabel ?? old!.groupLabel,
            before: old?.value ?? 'Not present',
            after: next?.value ?? 'Removed',
          },
        ];
  });
}
export function publicationIssues(detail: ReviewSummary, now: number): string[] {
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
export function ruleSummaries(rules: RewardRule[] | RewardRuleV2[] | RewardRuleV3[]) {
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
      rule.limitedTime ? `Limited time: ${limitedText(rule.limitedTime).toLowerCase()}.` : '',
      rule.excludedPaymentPaths.length ? `Excludes ${rule.excludedPaymentPaths.join(', ')}.` : '',
      ...('brandIds' in rule
        ? [
            rule.brandIds.length ? `Only at ${rule.brandIds.join(', ')}.` : '',
            rule.excludedBrandIds.length ? `Never at ${rule.excludedBrandIds.join(', ')}.` : '',
            rule.choice ? `${choiceText(rule)}.` : '',
            rule.requires.length ? `Requires ${requiresText(rule)}.` : '',
            rule.requiredPaymentPaths.length
              ? `Only when paying with ${rule.requiredPaymentPaths.join(', ')}.`
              : '',
            rule.sharedCapId ? `Shares its spend cap (${rule.sharedCapId}).` : '',
          ]
        : []),
    ].filter(Boolean);
    return {
      rule,
      title: `${percent(rule.rateBps)} · ${rule.category} · “${rule.issuerWording}”`,
      conditions: conditions.join(' '),
    };
  });
}
