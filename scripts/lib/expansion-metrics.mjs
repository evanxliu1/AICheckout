// Pipeline metrics for the catalog expansion: how much the per-issuer verification changed the agent-drafted
// labels (corpus.draft.json) on the way to the agent-verified corpus (corpus.json). Reads committed files only
// (no captures) and is deterministic, so every number in docs/evals/expansion.{md,json} can be recomputed.
//
// Draft rules keep their index through verification except where a `remove reference.rules.N` fix was applied
// (scripts/lib/expansion-verification.mjs applies removals by index and appends added rules), so each surviving
// draft rule is compared value by value with its verified counterpart. Anchors are evidence, not values, and are
// not counted as corrections.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** Rule fields compared between draft and verified labels (anchors excluded). */
export const RULE_VALUE_FIELDS = [
  'category',
  'issuerWording',
  'rateBps',
  'paidOnPaymentBps',
  'cap',
  'activation',
  'usMerchantsOnly',
  'limitedTime',
];
export const CARD_VALUE_FIELDS = ['rewardCurrency', 'pointValueHundredthsOfCent'];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const applied = (finding) => ['accepted', 'modified'].includes(finding.adjudication?.decision);
const rate = (count, total) => ({ count, total, rate: total ? Number((count / total).toFixed(4)) : null });
const RULE_PATH = /^reference\.rules\.(\d+)$/;
const ITEM_PATH = (key) => new RegExp(`^reference\\.${key}\\.\\d+$`);

/** The committed inputs: cards, draft and verified corpora, verification findings. No captures. */
export async function loadPipelineInputs(dir) {
  const names = (await readdir(join(dir, 'verification'))).filter((n) => n.endsWith('.json')).sort();
  return {
    cards: (await readJson(join(dir, 'cards.json'))).cards,
    draft: await readJson(join(dir, 'corpus.draft.json')),
    corpus: await readJson(join(dir, 'corpus.json')),
    files: await Promise.all(
      names.map(async (name) => ({ name, data: await readJson(join(dir, 'verification', name)) })),
    ),
  };
}

const emptyTally = () => ({
  cards: 0,
  inCorpus: 0,
  drafted: 0,
  undrafted: 0,
  confirmed: 0,
  fixed: 0,
  dropped: 0,
  draftRules: 0,
  rulesRemoved: 0,
  rulesAdded: 0,
  verifiedRules: 0,
  draftRulesUnchanged: 0,
  ruleFieldValues: 0,
  ruleFieldsChanged: 0,
  cardFieldValues: 0,
  cardFieldsChanged: 0,
});

/**
 * Compare drafts with verified labels. Throws if the verified corpus cannot be explained by the drafts and the
 * applied findings (a changed value with no applied fix on it, or rule counts that do not add up).
 */
export function pipelineMetrics({ cards, draft, corpus, files }) {
  const draftById = new Map(draft.cases.map((c) => [c.cardId, c]));
  const verifiedById = new Map(corpus.cases.map((c) => [c.cardId, c]));
  const entries = new Map();
  for (const file of files) for (const entry of file.data.cards) entries.set(entry.cardId, entry);
  const errors = [];

  const fieldChanges = Object.fromEntries(RULE_VALUE_FIELDS.map((f) => [f, 0]));
  const cardFieldChanges = Object.fromEntries(CARD_VALUE_FIELDS.map((f) => [f, 0]));
  const decisions = { accepted: 0, modified: 0, rejected: 0 };
  const items = { exclusionsRemoved: 0, exclusionsAdded: 0, issuesRemoved: 0, issuesAdded: 0 };
  const byIssuer = new Map();
  const total = emptyTally();
  const lists = { confirmed: [], dropped: [], undrafted: [], valuesUnchanged: [] };
  let undraftedRulesAdded = 0;

  for (const card of [...cards].sort((a, b) => a.id.localeCompare(b.id))) {
    const tallies = [
      total,
      byIssuer.get(card.issuer) ?? byIssuer.set(card.issuer, emptyTally()).get(card.issuer),
    ];
    const add = (key, n = 1) => tallies.forEach((t) => (t[key] += n));
    add('cards');
    const entry = entries.get(card.id);
    const draftCase = draftById.get(card.id);
    const verified = verifiedById.get(card.id);
    for (const finding of entry
      ? [
          ...entry.fixes,
          ...entry.addedRules,
          ...entry.addedExclusions,
          ...entry.addedIssues,
          ...entry.productNoteChanges,
        ]
      : [])
      if (finding.adjudication) decisions[finding.adjudication.decision]++;
    if (!verified) {
      add('dropped');
      lists.dropped.push({ cardId: card.id, issuer: card.issuer, drafted: Boolean(draftCase) });
      continue;
    }
    add('inCorpus');
    if (!entry) {
      errors.push(`${card.id}: in corpus.json but has no verification entry`);
      continue;
    }
    add(entry.verdict === 'confirmed' ? 'confirmed' : 'fixed');
    if (entry.verdict === 'confirmed') lists.confirmed.push(card.id);
    const fixes = entry.fixes.filter(applied);
    const addedRules = entry.addedRules.filter(applied);
    const removedOf = (key) => fixes.filter((f) => f.op === 'remove' && ITEM_PATH(key).test(f.path)).length;
    items.exclusionsRemoved += removedOf('exclusions');
    items.issuesRemoved += removedOf('issues');
    items.exclusionsAdded += entry.addedExclusions.filter(applied).length;
    items.issuesAdded += entry.addedIssues.filter(applied).length;
    add('rulesAdded', addedRules.length);
    add('verifiedRules', verified.reference.rules.length);
    if (!draftCase) {
      add('undrafted');
      undraftedRulesAdded += addedRules.length;
      lists.undrafted.push({ cardId: card.id, issuer: card.issuer, rules: verified.reference.rules.length });
      continue;
    }
    add('drafted');

    // Surviving draft rules, in order, then the added rules.
    const removed = new Set(
      fixes
        .filter((f) => f.op === 'remove' && RULE_PATH.test(f.path))
        .map((f) => Number(RULE_PATH.exec(f.path)[1])),
    );
    const kept = draftCase.reference.rules
      .map((rule, index) => ({ rule, index }))
      .filter((r) => !removed.has(r.index));
    add('draftRules', draftCase.reference.rules.length);
    add('rulesRemoved', removed.size);
    if (kept.length + addedRules.length !== verified.reference.rules.length) {
      errors.push(
        `${card.id}: ${draftCase.reference.rules.length} draft − ${removed.size} removed + ${addedRules.length} added ≠ ${verified.reference.rules.length} verified rules`,
      );
      continue;
    }
    const fixedPaths = fixes.filter((f) => f.op === 'set').map((f) => f.path);
    const hasFix = (prefix) => fixedPaths.some((p) => p === prefix || p.startsWith(`${prefix}.`));
    let changedValues = 0;
    kept.forEach(({ rule, index }, position) => {
      const after = verified.reference.rules[position];
      let changed = false;
      for (const field of RULE_VALUE_FIELDS) {
        add('ruleFieldValues');
        if (isDeepStrictEqual(rule[field], after[field])) continue;
        if (!hasFix(`reference.rules.${index}.${field}`))
          errors.push(`${card.id}: rules.${index}.${field} changed with no applied fix`);
        fieldChanges[field]++;
        add('ruleFieldsChanged');
        changed = true;
      }
      if (changed) changedValues++;
      else add('draftRulesUnchanged');
    });
    for (const field of CARD_VALUE_FIELDS) {
      add('cardFieldValues');
      if (draftCase.reference[field].value === verified.reference[field].value) continue;
      if (!hasFix(`reference.${field}.value`))
        errors.push(`${card.id}: ${field} changed with no applied fix`);
      cardFieldChanges[field]++;
      add('cardFieldsChanged');
      changedValues++;
    }
    if (!changedValues && !removed.size && !addedRules.length) lists.valuesUnchanged.push(card.id);
  }
  if (errors.length) throw new Error(`Pipeline metrics do not reconcile:\n${errors.join('\n')}`);

  const summary = (t) => ({
    ...t,
    ruleFieldCorrectionRate: rate(t.ruleFieldsChanged, t.ruleFieldValues).rate,
    cardFieldCorrectionRate: rate(t.cardFieldsChanged, t.cardFieldValues).rate,
    draftRulesRemovedRate: rate(t.rulesRemoved, t.draftRules).rate,
    draftRulesUnchangedRate: rate(t.draftRulesUnchanged, t.draftRules).rate,
  });
  const keptRules = total.draftRules - total.rulesRemoved;
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/expansion-pipeline-metrics.mjs',
    inputs: {
      draft: draft.version,
      corpus: corpus.version,
      annotationStatus: corpus.annotationStatus,
      verificationFiles: files.map((f) => f.name),
    },
    definitions: {
      drafted: 'corpus card with a case in corpus.draft.json (luna extraction → draft labels)',
      undrafted: 'corpus card with no draft case; verifiers wrote every label from the captures',
      ruleFieldCorrectionRate:
        'changed values / compared values over the draft rules that survive verification, fields ' +
        RULE_VALUE_FIELDS.join(', ') +
        ' (anchors excluded)',
      cardFieldCorrectionRate:
        'changed values / drafted cards × 2 (rewardCurrency, pointValueHundredthsOfCent)',
      draftRulesUnchangedRate: 'draft rules kept with every compared value unchanged / draft rules',
      confirmed: 'verifier verdict "confirmed": no label fix or addition (product-note changes allowed)',
      valuesUnchanged: 'drafted card whose rule and card values are all unchanged (anchors may differ)',
    },
    totals: summary(total),
    ruleFields: Object.fromEntries(RULE_VALUE_FIELDS.map((f) => [f, rate(fieldChanges[f], keptRules)])),
    cardFields: Object.fromEntries(
      CARD_VALUE_FIELDS.map((f) => [f, rate(cardFieldChanges[f], total.drafted)]),
    ),
    items,
    undraftedRulesAdded,
    findings: decisions,
    byIssuer: Object.fromEntries(
      [...byIssuer].sort((a, b) => a[0].localeCompare(b[0])).map(([issuer, t]) => [issuer, summary(t)]),
    ),
    cards: lists,
  };
}
