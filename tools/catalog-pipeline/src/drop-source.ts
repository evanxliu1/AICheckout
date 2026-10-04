// `pipeline drop-source --source <id> --reason <code>`: removes a source the batch cannot use (a bot wall, an error
// page, a page out of scope, a duplicate) from sources.json, manifest.json and the cards' sourceIds, moves its capture
// to captures-dropped/ (gitignored like captures/) and records the drop in state.json by reason code. The capture
// stage of the cards that cited it turns stale (their sources changed), so `run capture` re-checks them.
import { readFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { BATCHES_CONFIG_PATH, batchesConfigSchema } from '../../../scripts/lib/catalog-batches.mjs';
import { loadBatch, statePath } from './files.ts';
import { DROP_SOURCE_REASONS, writeJsonAtomic, writeState } from './state.ts';
import type { Env } from './run.ts';

export const DROPPED_CAPTURES = 'captures-dropped';

/**
 * Why a layer may not be changed, or null: a base layer of the build config is frozen, and so is a batch registered
 * in it while the config's version is published (its sources are in a published catalog).
 */
export async function frozenLayer(root: string, batchId: string): Promise<string | null> {
  const config = batchesConfigSchema.parse(
    JSON.parse(await readFile(join(root, BATCHES_CONFIG_PATH), 'utf8')),
  ) as { version: string; publishedVersions: string[]; layers: { kind: string; id: string }[] };
  const layer = config.layers.find((entry) => entry.id === batchId);
  if (layer?.kind === 'base') return `${batchId} is a frozen base layer of ${BATCHES_CONFIG_PATH}`;
  if (layer && config.publishedVersions.includes(config.version))
    return `${batchId} is a layer of the published catalog ${config.version}`;
  return null;
}

async function readJsonOrNull(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function dropSource(
  env: Env,
  batchId: string,
  sourceId: string,
  reason: string,
): Promise<number> {
  if (!(DROP_SOURCE_REASONS as readonly string[]).includes(reason)) {
    env.log(`drop-source: --reason must be one of ${DROP_SOURCE_REASONS.join(', ')}.`);
    return 2;
  }
  const frozen = await frozenLayer(env.root, batchId);
  if (frozen) {
    env.log(`drop-source: refused; ${frozen}.`);
    return 1;
  }
  const batch = await loadBatch(env.root, batchId);
  const citing = batch.cards.filter((card) => card.sourceIds.includes(sourceId));
  if (!batch.sources.has(sourceId) && !batch.manifest.has(sourceId) && !citing.length) {
    env.log(`drop-source: ${sourceId} is not a source of ${batchId}.`);
    return 1;
  }
  const orphaned = citing.filter((card) => card.sourceIds.length === 1).map((card) => card.id);
  if (orphaned.length) {
    env.log(
      `drop-source: refused; ${orphaned.join(', ')} would be left with no source. Drop the card instead (a drop-card verdict), then the source.`,
    );
    return 1;
  }

  for (const name of ['sources.json', 'manifest.json']) {
    const file = await readJsonOrNull(join(batch.dir, name));
    if (!file || !Array.isArray(file.sources)) continue;
    const sources = file.sources as { id: string }[];
    if (!sources.some((source) => source.id === sourceId)) continue;
    await writeJsonAtomic(join(batch.dir, name), {
      ...file,
      sources: sources.filter((source) => source.id !== sourceId),
    });
  }
  if (citing.length) {
    const file = (await readJsonOrNull(join(batch.dir, 'cards.json')))!;
    const cards = file.cards as { sourceIds: string[] }[];
    await writeJsonAtomic(join(batch.dir, 'cards.json'), {
      ...file,
      cards: cards.map((card) =>
        card.sourceIds.includes(sourceId)
          ? { ...card, sourceIds: card.sourceIds.filter((id) => id !== sourceId) }
          : card,
      ),
    });
  }
  await mkdir(join(batch.dir, DROPPED_CAPTURES), { recursive: true });
  const moved = await rename(
    join(batch.dir, 'captures', `${sourceId}.txt`),
    join(batch.dir, DROPPED_CAPTURES, `${sourceId}.txt`),
  ).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

  const now = env.now();
  const state = batch.state;
  state.droppedSources = {
    ...state.droppedSources,
    [sourceId]: { reason: reason as (typeof DROP_SOURCE_REASONS)[number], droppedAt: now.toISOString() },
  };
  if (state.resolvedFlags?.[sourceId]) delete state.resolvedFlags[sourceId];
  await writeState(statePath(batch.dir), state, now);
  env.log(
    `Dropped ${sourceId} (${reason})${citing.length ? ` from ${citing.map((card) => card.id).join(', ')}` : ''}; ` +
      `${moved ? `capture moved to ${batch.rel}/${DROPPED_CAPTURES}/` : 'no capture here to move'}. ` +
      'The capture stage of those cards is stale: run capture again.',
  );
  return 0;
}
