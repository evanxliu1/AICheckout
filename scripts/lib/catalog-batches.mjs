// Multi-batch inputs for the catalog v3 build (Phase 8 milestone 1). The committed build config
// (`evals/curation/catalog-batches.json`) lists the layers in order: the frozen base layer (`expansion.v1` in
// `evals/curation/expansion`, `real.v2.2` in `evals/curation/real`; never written) and then the pipeline batches in
// `evals/curation/batches/<batch>/`. `mergeLayers` turns them into the single input shape `checkOverlay`,
// `draftCatalogV3` and `buildCatalogV3` already take (one overlaid corpus, one real corpus, one overlay), so the
// build logic stays the one that produced release 2.
//
// Rules (wiki/system/card-expansion-pipeline.md, "Multi-batch catalog builder"):
// - Newest layer wins per card: a later layer's corpus case, overlay entry, program mapping and product notes replace
//   the earlier ones, or its drop removes the card. A replaced card keeps its position; new cards append.
// - Pairing: a pipeline batch's overlay entry carries `corpusCaseSha256`, the SHA-256 of the card's corpus case in the
//   same batch in canonical JSON (`stableJson`); a missing or different value is refused. Base layers are paired by
//   directory.
// - Completeness: every card of a layer's `cards.json` is in its corpus (the overlay includes it or holds it out with
//   a reason) or dropped with a reason.
// - A layer may add gates, store-credit programs and programDetails; redefining an ID with other content is refused.
//   The program table stays the frozen one: a batch maps its cards to existing programs only.
// - Real cards (a base layer without an overlay, `real.v2.2`) may be replaced by a pipeline batch (Phase 9), never by
//   a base layer and never dropped; the builder keeps their release-1 names and rule-ID prefixes.
// - Dates (Phase 9 freshness): a manifest source is dated by the newest freshness record that rendered the page with
//   the manifest's hash, else its own `checkedOn ?? capturedOn`; the merchant MCC sources likewise from
//   `real/merchant-manifest.json` (scripts/lib/freshness.mjs).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { stableJson } from '../../packages/rewards-core/src/schema.ts';
import { corpusCases } from './catalog-overlay.mjs';
import { MERCHANT_MANIFEST, freshDates, loadFreshnessRecords } from './freshness.mjs';

export const BATCHES_CONFIG_PATH = 'evals/curation/catalog-batches.json';
export const BATCHES_DIR = 'evals/curation/batches';

const reasons = z.record(z.string().min(1), z.string().trim().min(1).max(300));
const file = z.string().min(1);
const baseLayerSchema = z.strictObject({
  kind: z.literal('base'),
  /** The corpus version, e.g. `expansion.v1`. */
  id: z.string().min(1),
  dir: file,
  corpus: file,
  manifest: file,
  /** Null for a layer whose cards take no overlay (the real cards, pinned to release 1). */
  overlay: file.nullable(),
  notes: file.nullable(),
  cards: file.nullable(),
  /** Researched cards that never entered the corpus, with the reason. */
  dropped: reasons,
});
const batchLayerSchema = z.strictObject({
  kind: z.literal('batch'),
  /** The batch directory name under evals/curation/batches/, e.g. `wells-fargo-2026-10`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*-[0-9]{4}-[0-9]{2}$/),
  /** Dropped cards with reasons, until milestone 2's pipeline/state.json supplies them (`loadLayer`'s `dropped`). */
  dropped: reasons.default({}),
  /**
   * Per card, the starts of corpus exclusions the catalog leaves out because, listed with the card's other
   * exclusions, they would repeat more than 25 consecutive capture words (general rule 22; found by the quote check
   * over the built catalog). The batch-layer counterpart of `QUOTE_LIMIT_OMISSIONS`.
   */
  exclusionOmissions: z.record(z.string().min(1), z.array(z.string().trim().min(1)).min(1)).default({}),
});
/** A catalog version label, e.g. `2026-10-02.expansion.1` (date, name, counter). */
export const CATALOG_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$/;
const catalogVersion = z.string().regex(CATALOG_VERSION);
export const batchesConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1),
  /** The release catalog version label. */
  version: catalogVersion,
  /**
   * The v3 catalog versions Evan has published (the coordinator adds one in the PR after he publishes it). The builder
   * refuses to build a published version with other rule IDs or terms than its ledger entry, and never rewrites that
   * entry (wiki/ops/catalog-release.md).
   */
  publishedVersions: z
    .array(catalogVersion)
    .refine((versions) => new Set(versions).size === versions.length, 'published versions are unique'),
  /** The frozen reward-program table (programs and the base layer's card mappings). */
  programTable: file,
  merchants: file,
  layers: z
    .array(z.discriminatedUnion('kind', [baseLayerSchema, batchLayerSchema]))
    .min(1)
    .refine(
      (layers) => new Set(layers.map((layer) => layer.id)).size === layers.length,
      'layer IDs are unique',
    ),
});

const batchMappingSchema = z.looseObject({
  cardId: z.string().min(1),
  programId: z.string().min(1),
  statedValueHundredthsOfCent: z.number().int().nullable(),
});
/** A batch's optional reward-programs.json: card mappings only (the program table stays the frozen one). */
export const batchProgramsSchema = z.looseObject({ cards: z.array(batchMappingSchema) });

/** SHA-256 (hex) of a value's canonical JSON. */
export const sha256Json = (value) => createHash('sha256').update(stableJson(value)).digest('hex');

/** The date a manifest source was last confirmed: a freshness re-check (`checkedOn`, Phase 9) or its capture. */
export const sourceDate = (source) => source.checkedOn ?? source.capturedOn;

/**
 * One layer's files from the repository root. `dropped` (card ID → reason) adds dispositions from outside the config,
 * the hook for milestone 2's pipeline state.
 */
export async function loadLayer(root, layer, { dropped = {} } = {}) {
  const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const optional = async (path) => {
    try {
      return await read(path);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  if (layer.kind === 'base') {
    const at = (name) => (name === null ? null : read(join(layer.dir, name)));
    return {
      id: layer.id,
      kind: 'base',
      dir: layer.dir,
      corpus: await at(layer.corpus),
      manifest: await at(layer.manifest),
      overlay: await at(layer.overlay),
      notes: await at(layer.notes),
      cards: await at(layer.cards),
      rewardPrograms: null,
      dropped: { ...layer.dropped, ...dropped },
    };
  }
  const dir = join(BATCHES_DIR, layer.id);
  return {
    id: layer.id,
    kind: 'batch',
    dir,
    corpus: await read(join(dir, 'corpus.json')),
    manifest: await read(join(dir, 'manifest.json')),
    overlay: await read(join(dir, 'catalog-overlay.json')),
    notes: await read(join(dir, 'product-notes.verified.json')),
    cards: await read(join(dir, 'cards.json')),
    rewardPrograms: await optional(join(dir, 'reward-programs.json')),
    dropped: { ...layer.dropped, ...dropped },
    exclusionOmissions: layer.exclusionOmissions ?? {},
  };
}

/**
 * The manifest source that dates and hashes each source ID, in layer order: a later capture or check of the same ID
 * replaces an earlier one when its date is newer. A source's date is the newest freshness record date on which the
 * page rendered with the manifest's hash, when that is newer than its own `checkedOn ?? capturedOn` (then the
 * returned source carries it as `checkedOn`). Returns source ID → `{ source, layer }` (layer ID).
 */
export function effectiveSources(layers, freshness = []) {
  const fresh = freshDates(freshness);
  const out = new Map();
  for (const layer of layers)
    for (const listed of layer.manifest.sources) {
      const checked = fresh.get(`${listed.id} ${listed.sha256}`);
      const source = checked && checked > sourceDate(listed) ? { ...listed, checkedOn: checked } : listed;
      const earlier = out.get(source.id);
      if (!earlier || sourceDate(source) > sourceDate(earlier.source))
        out.set(source.id, { source, layer: layer.id });
    }
  return out;
}

/** merchants.json with each MCC source's `checkedOn` moved to a newer freshness date of its captured hash. */
export function freshMerchants(merchants, merchantManifest, freshness = []) {
  if (!merchantManifest || !freshness.length) return merchants;
  const fresh = freshDates(freshness);
  const hashes = new Map(merchantManifest.sources.map((source) => [source.id, source.sha256]));
  return {
    ...merchants,
    sources: merchants.sources.map((source) => {
      const checked = fresh.get(`${source.id} ${hashes.get(source.id)}`);
      return checked && checked > source.checkedOn ? { ...source, checkedOn: checked } : source;
    }),
  };
}

/**
 * The config, its layers, the program table, merchants, the merchant MCC manifest (null when absent) and the
 * freshness records, read from the repository root.
 */
export async function loadCatalogBatches(root, path = BATCHES_CONFIG_PATH) {
  const read = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));
  // The config may live outside the root (a proposed build's config); the paths inside it are root-relative.
  const config = batchesConfigSchema.parse(JSON.parse(await readFile(resolve(root, path), 'utf8')));
  const layers = [];
  for (const layer of config.layers) layers.push(await loadLayer(root, layer));
  return {
    config,
    layers,
    programTable: await read(config.programTable),
    merchants: await read(config.merchants),
    merchantManifest: await read(MERCHANT_MANIFEST).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
    freshness: await loadFreshnessRecords(root),
  };
}

/** Gate, store-program and brand IDs an overlay card entry uses. */
function entryUses(entry) {
  const gates = new Set();
  const brands = new Set(entry.acceptance?.kind === 'closed-loop' ? entry.acceptance.brandIds : []);
  for (const fields of [
    ...(entry.rules ?? []).map((patch) => patch.set ?? {}),
    ...(entry.addedRules ?? []),
  ]) {
    for (const requirement of fields.requires ?? []) gates.add(requirement.gateId);
    for (const id of [...(fields.brandIds ?? []), ...(fields.excludedBrandIds ?? [])]) brands.add(id);
  }
  return { gates, programs: new Set(entry.programId ? [entry.programId] : []), brands };
}

/**
 * The build inputs from the loaded layers: `{ version, overlay, merchants, corpora, notes, rewardPrograms, manifests,
 * cardOrder, dropped, layers }`, where `corpora` is [overlaid cards, real cards] as `loadOverlayInputs` returns.
 * Throws with every problem found (pairing, completeness, redefinitions, unknown programs).
 */
export function mergeLayers({
  config,
  layers,
  programTable,
  merchants: listedMerchants,
  merchantManifest = null,
  freshness = [],
}) {
  const merchants = freshMerchants(listedMerchants, merchantManifest, freshness);
  const problems = [];
  const winner = new Map(); // card ID → { layer, case | dropped }
  const firstSeen = []; // card IDs in order of first appearance
  const see = (cardId, record) => {
    if (!winner.has(cardId)) firstSeen.push(cardId);
    winner.set(cardId, record);
  };
  const plainCards = new Map(); // card ID → layer ID, for layers without an overlay
  const summaries = [];

  for (const layer of layers) {
    const at = `layer ${layer.id}`;
    const cases = corpusCases(layer.corpus);
    if (layer.kind === 'base' && layer.corpus.version !== layer.id)
      problems.push(`${at}: corpus version is ${layer.corpus.version}`);
    if (layer.kind === 'batch' && layer.overlay === null) problems.push(`${at}: a batch needs an overlay`);

    // Completeness against cards.json (a layer without one, the real cards, is its corpus).
    const researched = layer.cards ? layer.cards.cards.map((card) => card.id) : [...cases.keys()];
    const researchedSet = new Set(researched);
    for (const id of researched)
      if (!cases.has(id) && !layer.dropped[id])
        problems.push(`${at}: card ${id} is neither in the corpus nor dropped with a reason`);
    for (const id of cases.keys())
      if (!researchedSet.has(id)) problems.push(`${at}: corpus card ${id} is not in cards.json`);
    for (const id of Object.keys(layer.dropped)) {
      if (!researchedSet.has(id)) problems.push(`${at}: dropped card ${id} is not in cards.json`);
      if (cases.has(id)) problems.push(`${at}: dropped card ${id} is in the corpus`);
    }

    // Pairing: every overlay entry belongs to a corpus case of the same layer.
    if (layer.overlay)
      for (const entry of layer.overlay.cards) {
        const item = cases.get(entry.cardId);
        if (!item) problems.push(`${at}: overlay entry ${entry.cardId} has no corpus case in the layer`);
        else if (layer.kind === 'batch' || entry.corpusCaseSha256 !== undefined) {
          if (entry.corpusCaseSha256 === undefined)
            problems.push(`${at}: overlay entry ${entry.cardId} has no corpusCaseSha256`);
          else if (entry.corpusCaseSha256 !== sha256Json(item))
            problems.push(`${at}: overlay entry ${entry.cardId} is not paired with the layer's corpus case`);
        }
      }

    for (const [cardId, item] of cases) {
      // A real card may be replaced by a pipeline batch (refresh), never by a base layer.
      if (plainCards.has(cardId) && layer.kind !== 'batch')
        problems.push(
          `${at}: card ${cardId} is a ${plainCards.get(cardId)} card, which only a pipeline batch may replace`,
        );
      if (!layer.overlay) {
        if (winner.has(cardId))
          problems.push(`${at}: card ${cardId} is also in ${winner.get(cardId).layer.id}`);
        plainCards.set(cardId, layer.id);
      }
      see(cardId, { layer, item });
    }
    for (const cardId of researched)
      if (!cases.has(cardId)) {
        if (plainCards.has(cardId))
          problems.push(`${at}: card ${cardId} is a ${plainCards.get(cardId)} card, which no layer may drop`);
        see(cardId, { layer, dropped: layer.dropped[cardId] });
      }
    summaries.push({ id: layer.id, kind: layer.kind, dir: layer.dir, corpusVersion: layer.corpus.version });
  }

  // Program mappings: the frozen table, then each batch's, newest winning per card.
  const programIds = new Set(programTable.programs.map((program) => program.id));
  const mappings = new Map(programTable.cards.map((card) => [card.cardId, card]));
  for (const layer of layers) {
    if (!layer.rewardPrograms) continue;
    const parsed = batchProgramsSchema.safeParse(layer.rewardPrograms);
    if (!parsed.success) {
      problems.push(`layer ${layer.id}: reward-programs.json is invalid`);
      continue;
    }
    if (layer.rewardPrograms.programs !== undefined)
      problems.push(`layer ${layer.id}: reward-programs.json may map cards only, not define programs`);
    const cases = corpusCases(layer.corpus);
    for (const card of parsed.data.cards) {
      if (!cases.has(card.cardId))
        problems.push(`layer ${layer.id}: program mapping for ${card.cardId}, which is not in its corpus`);
      if (!programIds.has(card.programId))
        problems.push(`layer ${layer.id}: ${card.cardId} maps to unknown program ${card.programId}`);
      mappings.set(card.cardId, card);
    }
  }

  // Definitions: union over the layers; the same ID with other content is a redefinition.
  const defs = { gates: new Map(), programs: new Map(), programDetails: new Map() };
  const keyOf = { gates: 'id', programs: 'id', programDetails: 'programId' };
  for (const layer of layers)
    for (const kind of Object.keys(defs))
      for (const def of layer.overlay?.[kind] ?? []) {
        const id = def[keyOf[kind]];
        const earlier = defs[kind].get(id);
        if (!earlier) defs[kind].set(id, { def, layer: layer.id });
        else if (earlier.layer === layer.id)
          problems.push(`layer ${layer.id}: ${kind} ${id} is defined twice`);
        else if (stableJson(earlier.def) !== stableJson(def))
          problems.push(`layer ${layer.id}: ${kind} ${id} redefines the one in ${earlier.layer}`);
      }
  if (problems.length) throw new Error(`The catalog batches fail:\n- ${problems.join('\n- ')}`);

  // The winning cards, in first-appearance order.
  const winners = firstSeen.map((cardId) => [cardId, winner.get(cardId)]);
  const overlaid = winners.filter(([, w]) => w.item && w.layer.overlay);
  const plain = winners.filter(([, w]) => w.item && !w.layer.overlay);
  const plainIds = new Set(plain.map(([cardId]) => cardId));
  const entryOf = (cardId, layer) => layer.overlay.cards.find((entry) => entry.cardId === cardId);
  const entries = overlaid.map(([cardId, w]) => entryOf(cardId, w.layer));

  // Gates, store programs and brands that only replaced or dropped cards used are pruned, so a refresh does not
  // fail the overlay's "unused" check; a definition nobody ever used still fails it.
  const usedBefore = { gates: new Set(), programs: new Set(), brands: new Set() };
  const usedNow = { gates: new Set(), programs: new Set(), brands: new Set() };
  for (const layer of layers)
    for (const entry of layer.overlay?.cards ?? [])
      for (const [kind, ids] of Object.entries(entryUses(entry)))
        ids.forEach((id) => usedBefore[kind].add(id));
  for (const entry of entries)
    for (const [kind, ids] of Object.entries(entryUses(entry))) ids.forEach((id) => usedNow[kind].add(id));
  const orphan = (kind, id) => usedBefore[kind].has(id) && !usedNow[kind].has(id);
  const gates = [...defs.gates.values()].map((d) => d.def).filter((gate) => !orphan('gates', gate.id));
  const programs = [...defs.programs.values()].map((d) => d.def).filter((p) => !orphan('programs', p.id));
  const programDetails = [...defs.programDetails.values()]
    .map((d) => d.def)
    .filter((detail) => !orphan('programs', detail.programId));
  const otherBrandUses = new Set([
    ...merchants.merchants.flatMap((m) => m.brandIds),
    ...programs.flatMap((p) => p.redemptionBrandIds),
    ...programDetails.flatMap((d) => d.redemptionBrandIds),
  ]);
  const brands = merchants.brands.filter((b) => otherBrandUses.has(b.id) || !orphan('brands', b.id));

  // Manifest sources in layer order; a later capture or check of the same source ID replaces it in place.
  const sources = new Map([...effectiveSources(layers, freshness)].map(([id, { source }]) => [id, source]));

  const firstOverlay = layers.find((layer) => layer.overlay);
  const firstPlain = layers.find((layer) => !layer.overlay);
  const notesOf = (cardId, layer) => layer.notes?.cards.find((card) => card.cardId === cardId);
  const winnerLayer = new Map(winners.map(([cardId, w]) => [cardId, w.layer.id]));
  return {
    version: config.version,
    overlay: { ...firstOverlay.overlay, gates, programs, programDetails, cards: entries },
    merchants: { ...merchants, brands },
    corpora: [
      { ...firstOverlay.corpus, cases: overlaid.map(([, w]) => w.item) },
      {
        ...(firstPlain?.corpus ?? { version: 'none' }),
        // Real cards a batch replaced are in the overlaid corpus instead.
        cases: layers
          .filter((layer) => !layer.overlay)
          .flatMap((layer) => layer.corpus.cases)
          .filter((item) => plainIds.has(item.cardId)),
      },
    ],
    notes: {
      ...firstOverlay.notes,
      cards: overlaid.map(([cardId, w]) => notesOf(cardId, w.layer)).filter(Boolean),
    },
    rewardPrograms: { ...programTable, cards: [...mappings.values()] },
    manifests: [{ schemaVersion: 1, sources: [...sources.values()] }],
    cardOrder: winners.filter(([, w]) => w.item).map(([cardId]) => cardId),
    dropped: winners
      .filter(([, w]) => w.dropped)
      .map(([cardId, w]) => ({ cardId, layer: w.layer.id, reason: w.dropped })),
    layers: summaries.map((summary) => ({
      ...summary,
      cards: winners.filter(([, w]) => w.item && w.layer.id === summary.id).length,
      replaced: [...corpusCases(layers.find((layer) => layer.id === summary.id).corpus).keys()].filter(
        (cardId) => winnerLayer.get(cardId) !== summary.id,
      ),
    })),
    /** Exclusion omissions of the cards a pipeline batch supplies, from that batch's build-config entry. */
    batchOmissions: Object.fromEntries(
      winners
        .filter(([cardId, w]) => w.item && w.layer.kind === 'batch' && w.layer.exclusionOmissions?.[cardId])
        .map(([cardId, w]) => [cardId, w.layer.exclusionOmissions[cardId]]),
    ),
    /** Cards whose labels still come from a frozen base layer (not replaced by a pipeline batch). */
    fromBase: winners.filter(([, w]) => w.item && w.layer.kind === 'base').map(([cardId]) => cardId),
    /** Real cards (a layer without an overlay) that a pipeline batch replaced. */
    replacedReal: [...plainCards.keys()].filter((cardId) => !plainIds.has(cardId)),
    researched: new Set(layers.flatMap((layer) => (layer.cards?.cards ?? []).map((card) => card.id))).size,
  };
}
