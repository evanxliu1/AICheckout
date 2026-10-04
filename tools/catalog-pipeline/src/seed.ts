// `pipeline init <batch> --issuer "<Name>" --refresh-from-freshness <date> [--cards ids]` (Phase 9): a refresh batch
// for the issuer's catalog cards whose sources a freshness record found changed. Instead of a researcher agent, the
// batch is seeded from the build-config layer each card currently comes from: its cards.json entry, every one of its
// sources (unchanged ones too: the batch re-captures all of a card's pages, as new dated captures), the layer's
// capture hints for them and an empty exclusions.json. Research is recorded `done` with provenance `seeded`; its input
// hash covers the seed files and the freshness record. The real cards (a layer without cards.json) get a cards.json
// entry built, as scripts/build-expansion-cards.mjs builds one, from their entry in docs/research/cards-2026.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { batchDir, batchFileSchema, loadBatch, slugify, statePath } from './files.ts';
import { FRESHNESS_DIR } from '../../../scripts/lib/freshness.mjs';
import { freshnessPlan, readFreshnessRecord } from './freshness.ts';
import type { CatalogCard } from './freshness.ts';
import { inputHash } from './hash.ts';
import { researchInputs } from './inputs.ts';
import type { Env } from './run.ts';
import { BATCH_ID, initialState, writeJsonAtomic, writeState } from './state.ts';

/** Where the Phase 7 research of the real cards is (each real card has an entry there). */
export const RESEARCH_DIR = 'docs/research/cards-2026';

export interface SeedOptions {
  issuer: string;
  freshness: string;
  /** Card IDs; default: the issuer's cards with a changed source in the record. */
  cards?: string[];
  summary?: string;
}

type Json = Record<string, unknown>;

async function readJson(path: string, fallback?: unknown): Promise<Json> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Json;
  } catch (error) {
    if (fallback !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return fallback as Json;
    throw error;
  }
}

/** Ongoing annual fee as scripts/build-expansion-cards.mjs `annualFee` reads the research's text. */
function annualFee(text: string): { annualFeeUsd: number | null; annualFeeNote: string | null } {
  const dollars = (value: string) => Number(value.replace(/,/g, ''));
  const plain = /^\$([\d,]+)$/.exec(text.trim());
  if (plain) return { annualFeeUsd: dollars(plain[1]), annualFeeNote: null };
  const then = /then \$([\d,]+)/.exec(text);
  if (then) return { annualFeeUsd: dollars(then[1]), annualFeeNote: text };
  const lead = /^\$([\d,]+)\b(?!\s*-)/.exec(text.trim());
  if (lead) return { annualFeeUsd: dollars(lead[1]), annualFeeNote: text };
  return { annualFeeUsd: null, annualFeeNote: text };
}

const cleanName = (name: string) => name.replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim();

/** A cards.json entry for a card of a layer without one (the real cards), from its Phase 7 research entry. */
async function researchedCard(root: string, card: CatalogCard): Promise<Json> {
  const names = (await readdir(join(root, RESEARCH_DIR))).filter((name) => name.endsWith('.json')).sort();
  for (const name of names) {
    const file = await readJson(join(root, RESEARCH_DIR, name));
    const entry = (file.cards as Json[]).find((item) => item.id === card.cardId);
    if (!entry) continue;
    return {
      id: card.cardId,
      name: cleanName(String(entry.name)),
      issuer: card.issuer,
      group: entry.group,
      coBrandPartner: entry.coBrandPartner ?? null,
      closedLoop: entry.closedLoop === true,
      network: entry.network ?? null,
      ...annualFee(String(entry.annualFee ?? '')),
      rewardCurrency: entry.rewardCurrency,
      notes: [],
      research: `${RESEARCH_DIR}/${name}`,
      sourceIds: card.sourceIds,
    };
  }
  throw new Error(`${card.cardId}: no research entry in ${RESEARCH_DIR} to seed its cards.json entry from.`);
}

export async function seedRefreshBatch(env: Env, batch: string, options: SeedOptions): Promise<number> {
  if (!BATCH_ID.test(batch)) throw new Error(`Batch id must match ${BATCH_ID} (e.g. amex-refresh-2026-10).`);
  const dir = batchDir(env.root, batch);
  if ((await readJson(join(dir, 'pipeline', 'batch.json'), null)) !== null) {
    env.log(`Batch ${batch} already exists; refusing to overwrite it.`);
    return 1;
  }
  const record = await readFreshnessRecord(env.root, options.freshness);
  if (!record) {
    env.log(`No freshness record ${FRESHNESS_DIR}/${options.freshness}.json.`);
    return 1;
  }
  const slug = slugify(options.issuer);
  const plan = await freshnessPlan(env.root);
  const issuerCards = new Map(
    plan.cards.filter((card) => slugify(card.issuer) === slug).map((card) => [card.cardId, card]),
  );
  if (!issuerCards.size) {
    env.log(`No card of issuer "${options.issuer}" in the build config's catalog.`);
    return 1;
  }
  const changed = new Set(record.sources.filter((e) => e.result === 'changed').map((e) => e.sourceId));
  const isChanged = (card: CatalogCard) => card.sourceIds.some((id) => changed.has(id));
  let selected: CatalogCard[];
  if (options.cards?.length) {
    const unknown = options.cards.filter((id) => !issuerCards.has(id));
    if (unknown.length) {
      env.log(`Not a catalog card of ${options.issuer}: ${unknown.join(', ')} (use card IDs).`);
      return 1;
    }
    selected = options.cards.map((id) => issuerCards.get(id)!);
    const unchanged = selected.filter((card) => !isChanged(card)).map((card) => card.cardId);
    if (unchanged.length)
      env.log(`Named explicitly, no changed source in the record: ${unchanged.join(', ')}`);
  } else {
    selected = [...issuerCards.values()].filter(isChanged);
    if (!selected.length) {
      env.log(
        `The ${options.freshness} record found no changed source of ${options.issuer}'s cards; name cards with --cards to refresh them anyway.`,
      );
      return 1;
    }
  }

  // Seed files from each card's current layer.
  const cards: Json[] = [];
  const sources = new Map<string, Json & { cardIds: string[] }>();
  const hints: Json = {};
  const layerFiles = new Map<string, { sources: Json[]; hints: Json; cards: Json[] | null }>();
  for (const card of selected) {
    const layer = card.layer;
    if (!layerFiles.has(layer.id))
      layerFiles.set(layer.id, {
        sources: (await readJson(join(env.root, layer.dir, 'sources.json'))).sources as Json[],
        hints: await readJson(join(env.root, layer.dir, 'capture-hints.json'), {}),
        cards: layer.cards ? (layer.cards.cards as unknown as Json[]) : null,
      });
    const files = layerFiles.get(layer.id)!;
    const entry = files.cards
      ? files.cards.find((item) => item.id === card.cardId)
      : await researchedCard(env.root, card);
    if (!entry) throw new Error(`${card.cardId}: not in ${layer.dir}/cards.json`);
    cards.push(entry);
    for (const sourceId of entry.sourceIds as string[]) {
      const source = files.sources.find((item) => item.id === sourceId);
      if (!source) throw new Error(`${card.cardId}: source ${sourceId} is not in ${layer.dir}/sources.json`);
      const earlier = sources.get(sourceId);
      sources.set(sourceId, { ...source, cardIds: [...(earlier?.cardIds ?? []), card.cardId] });
      if (sourceId in files.hints) hints[sourceId] = files.hints[sourceId];
    }
  }
  const domains = [
    ...new Set(
      [...sources.values()].map((source) =>
        new URL(String(source.url)).hostname.toLowerCase().replace(/^www\./, ''),
      ),
    ),
  ].sort();
  const now = env.now();
  const layers = [...new Set(selected.map((card) => card.layer.id))].sort();
  const meta = batchFileSchema.parse({
    schemaVersion: 1,
    batch,
    issuers: [{ name: options.issuer, slug, domains }],
    requestedCards: selected.map((card) => card.cardId),
    refresh: true,
    summary: options.summary ?? null,
    createdAt: now.toISOString(),
    seed: { freshness: options.freshness, layers },
  });
  const generatedBy = 'tools/catalog-pipeline init --refresh-from-freshness';
  await writeJsonAtomic(join(dir, 'cards.json'), {
    schemaVersion: 1,
    generatedBy,
    description: `Cards of a refresh batch seeded from the freshness record of ${options.freshness} and the layers ${layers.join(', ')}. Fields other than id, issuer, group and sources are research hints; rates come from the captures.`,
    cards,
  });
  await writeJsonAtomic(join(dir, 'sources.json'), { schemaVersion: 1, sources: [...sources.values()] });
  await writeJsonAtomic(join(dir, 'exclusions.json'), { schemaVersion: 1, generatedBy, exclusions: [] });
  await writeJsonAtomic(join(dir, 'capture-hints.json'), hints);
  await writeJsonAtomic(join(dir, 'pipeline', 'batch.json'), meta);
  const state = initialState(batch, [slug], now);
  await writeState(statePath(dir), state, now);
  // Research is done by seeding: record it with the hash the derivation will recompute.
  const loaded = await loadBatch(env.root, batch);
  const inputs = await researchInputs(loaded, slug);
  state.issuers[slug].stages.research = {
    status: 'done',
    stageVersion: inputs.stageVersion,
    inputHash: inputHash('research', inputs.stageVersion, inputs.config, inputs.inputs),
    finishedAt: now.toISOString(),
    provenance: 'seeded',
  };
  await writeState(statePath(dir), state, now);
  env.log(
    `Batch ${batch} seeded from ${FRESHNESS_DIR}/${options.freshness}.json: ${selected.length} card(s) (${selected
      .map((card) => card.cardId)
      .join(
        ', ',
      )}), ${sources.size} source(s) from ${layers.join(', ')}; research done (seeded). Next: npm run pipeline -- next --batch ${batch} --json`,
  );
  return 0;
}
