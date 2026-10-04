// The deterministic gates of the agent stages (wiki/system/card-expansion-pipeline.md, "Gates"). Every gate returns
// errors as `<file or field path>: <problem>` and never echoes issuer text: values in quotation marks are redacted
// (`redact`) and the quote check reports where a run is, not the run.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Batch } from './files.ts';
import { jsonSha256 } from './hash.ts';
import { verifierFindings } from './inputs.ts';
import { lintCorpusCase, lintOverlay, formatFinding } from './label-lint.ts';
import type { CorpusCaseLike, OverlayLike } from './label-lint.ts';
import type { Packet } from './packets.ts';
import { valueAt } from './rebase.ts';
import { checkQuoteFiles } from '../../../scripts/lib/expansion-quote-check.mjs';
import {
  applyVerification,
  loadExpansion,
  verificationFileSchema,
} from '../../../scripts/lib/expansion-verification.mjs';
import {
  checkOverlay,
  corpusCases,
  gateSchema,
  overlayCardSchema,
  programDetailSchema,
  storeProgramSchema,
} from '../../../scripts/lib/catalog-overlay.mjs';
import {
  BATCHES_CONFIG_PATH,
  batchesConfigSchema,
  loadLayer,
  mergeLayers,
  sha256Json,
} from '../../../scripts/lib/catalog-batches.mjs';
import { catalogDates } from '../../../scripts/lib/catalog-v3.mjs';

/** Replaces every quoted span ("…", “…”) with an ellipsis, so an error can name a field but not its text. */
export const redact = (message: string): string =>
  message.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/“[^”]*”/g, '“…”');

const zodErrors = (prefix: string, error: z.ZodError): string[] =>
  error.issues.map((issue) => redact(`${prefix}${issue.path.join('.') || '(file)'}: ${issue.message}`));

/** The copyright gate: no committed batch file repeats more than 25 words of a capture, alone or read together. */
export async function quoteGate(
  batch: Batch,
  { requireCaptures = true }: { requireCaptures?: boolean } = {},
): Promise<string[]> {
  const result = await checkQuoteFiles({
    root: batch.root,
    dir: batch.dir,
    captureDirs: [join(batch.dir, 'captures')],
    catalog: null,
  });
  if (result.noCaptures)
    return requireCaptures
      ? ['captures/: no capture on this machine; accept in the checkout that holds the captures']
      : [];
  return (result.problems as { file: string; at: string; code: string }[]).map(
    (problem) => `${problem.file} ${problem.at}: quote check (${problem.code})`,
  );
}

/** The batch's apply step in check mode (`apply-expansion-verification.mjs --check`), errors redacted. */
export async function applyCheck(batch: Batch): Promise<string[]> {
  const state = await loadExpansion(batch.dir);
  return (applyVerification(state).errors as string[]).map(redact);
}

interface Envelope {
  packetId?: unknown;
  batch?: unknown;
  issuer?: unknown;
}

/** The output must carry the open packet's ID, batch and issuer name. */
export function envelopeGate(packet: Packet, data: unknown): string[] {
  const value = (data ?? {}) as Envelope;
  const errors: string[] = [];
  if (value.packetId !== packet.packetId) errors.push('packetId: does not match the open packet');
  if (value.batch !== packet.batch) errors.push('batch: does not match the open packet');
  if (value.issuer !== packet.issuerName) errors.push('issuer: does not match the open packet');
  return errors;
}

interface FindingsCardLike {
  cardId: string;
  verdict: string;
  verdictAdjudication?: unknown;
  fixes: { op: string; path: string; current: unknown; adjudication?: unknown }[];
  addedRules: { adjudication?: unknown }[];
  addedExclusions: { adjudication?: unknown }[];
  addedIssues: { adjudication?: unknown }[];
  productNoteChanges: { adjudication?: unknown }[];
}
interface FindingsFileLike {
  provenance?: string;
  verifier: { filesRead: string[] };
  adjudicator: unknown;
  cards: FindingsCardLike[];
}

/** Entries of cards outside the packet must be unchanged since the claim; every packet card needs an entry. */
function scopeGate(packet: Packet, file: FindingsFileLike): string[] {
  const errors: string[] = [];
  const inPacket = new Set(packet.cardIds);
  const frozen = packet.frozen?.entries ?? {};
  for (const entry of file.cards)
    if (!inPacket.has(entry.cardId) && frozen[entry.cardId] !== jsonSha256(entry))
      errors.push(`cards.${entry.cardId}: outside the packet (added or changed)`);
  for (const cardId of Object.keys(frozen))
    if (!file.cards.some((entry) => entry.cardId === cardId))
      errors.push(`cards.${cardId}: outside the packet (removed)`);
  for (const cardId of packet.cardIds)
    if (!file.cards.some((entry) => entry.cardId === cardId))
      errors.push(`cards.${cardId}: no entry for a card of the packet`);
  return errors;
}

function parseFindings(data: unknown, errors: string[]): FindingsFileLike | null {
  const parsed = verificationFileSchema.safeParse(data);
  if (!parsed.success) {
    errors.push(...zodErrors('', parsed.error));
    return null;
  }
  const file = parsed.data as FindingsFileLike;
  if (file.provenance !== 'agent-verified') errors.push('provenance: must be agent-verified');
  return file;
}

const packetErrors = (errors: string[], packet: Packet): string[] =>
  errors.filter((error) => packet.cardIds.some((cardId) => error.includes(`: ${cardId}: `)));

/** Verify: findings parse, stay inside the packet, `current` equals the draft, filesRead names the captures, every
 * quote is verbatim in its capture and at most 25 words, and the batch passes the quote check. */
export async function verifyGate(batch: Batch, packet: Packet, data: unknown): Promise<string[]> {
  const errors = envelopeGate(packet, data);
  const file = parseFindings(data, errors);
  if (!file) return errors;
  errors.push(...scopeGate(packet, file));
  for (const entry of file.cards) {
    if (!packet.cardIds.includes(entry.cardId)) continue;
    const draft = batch.draft.get(entry.cardId);
    entry.fixes.forEach((fix, i) => {
      const value = valueAt(draft, fix.path);
      if (value === undefined) errors.push(`cards.${entry.cardId}.fixes.${i}.path: not in the draft`);
      else if (!isDeepStrictEqual(value ?? null, fix.current))
        errors.push(`cards.${entry.cardId}.fixes.${i}.current: does not match the draft`);
    });
    const card = batch.cards.find((item) => item.id === entry.cardId);
    for (const sourceId of card?.sourceIds ?? [])
      if (
        batch.manifest.has(sourceId) &&
        !file.verifier.filesRead.some((path) => path.endsWith(`captures/${sourceId}.txt`))
      )
        errors.push(`verifier.filesRead: does not name captures/${sourceId}.txt (${entry.cardId})`);
  }
  if (errors.length) return errors;
  errors.push(...packetErrors(await applyCheck(batch), packet));
  errors.push(...(await quoteGate(batch)));
  return errors;
}

const decided = (item: { adjudication?: unknown }) => item.adjudication !== undefined;

/** Adjudicate: every finding and drop-card verdict of the packet's cards decided, the verifier's findings and block
 * untouched, `apply --check` passes on the batch, and the batch passes the quote check. (The run ≠ verifier run and
 * claimed-after-verify rules are checked by `accept` before the gate.) */
export async function adjudicateGate(batch: Batch, packet: Packet, data: unknown): Promise<string[]> {
  const errors = envelopeGate(packet, data);
  const file = parseFindings(data, errors);
  if (!file) return errors;
  errors.push(...scopeGate(packet, file));
  if (file.adjudicator === null)
    errors.push('adjudicator: missing (fill it in once every finding is decided)');
  if (packet.frozen?.verifier && jsonSha256(file.verifier) !== packet.frozen.verifier)
    errors.push('verifier: changed by the adjudicator');
  for (const entry of file.cards) {
    if (!packet.cardIds.includes(entry.cardId)) continue;
    const at = `cards.${entry.cardId}`;
    const expected = packet.frozen?.findings[entry.cardId];
    if (expected && jsonSha256(verifierFindings(entry as never)) !== expected)
      errors.push(`${at}: the verifier's findings changed (only adjudication fields may be added)`);
    for (const key of [
      'fixes',
      'addedRules',
      'addedExclusions',
      'addedIssues',
      'productNoteChanges',
    ] as const)
      entry[key].forEach((item, i) => {
        if (!decided(item)) errors.push(`${at}.${key}.${i}.adjudication: undecided`);
      });
    if (entry.verdict === 'drop-card' && entry.verdictAdjudication === undefined)
      errors.push(`${at}.verdictAdjudication: undecided drop-card`);
  }
  if (errors.length) return errors;
  errors.push(...(await applyCheck(batch)));
  errors.push(...(await quoteGate(batch)));
  return errors;
}

/** The overlay agent's fragment, overlay/<issuer-slug>.json: the issuer's overlay entries and their definitions. */
export const overlayFragmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.string(),
  batch: z.string(),
  issuer: z.string(),
  provenance: z.literal('agent-verified'),
  cards: z.array(overlayCardSchema),
  gates: z.array(gateSchema).default([]),
  programs: z.array(storeProgramSchema).default([]),
  programDetails: z.array(programDetailSchema).default([]),
  /** Card → existing program of the frozen table (reward-programs.json card mappings of the batch). */
  rewardPrograms: z
    .array(
      z.strictObject({
        cardId: z.string(),
        programId: z.string(),
        statedValueHundredthsOfCent: z.int().nullable(),
      }),
    )
    .default([]),
});
type Fragment = z.infer<typeof overlayFragmentSchema>;

interface OverlayFile extends OverlayLike {
  gates: { id: string }[];
  programs: { id: string; unitName: string; redemptionBrandIds: string[] }[];
  programDetails: { programId: string; unitName: string; redemptionBrandIds: string[] }[];
  cards: (OverlayLike['cards'][number] & { issuer?: string })[];
}

type DefinitionKind = 'gates' | 'programs' | 'programDetails';
const DEFINITION_KEY: Record<DefinitionKind, (item: Record<string, unknown>) => string> = {
  gates: (item) => String(item.id),
  programs: (item) => String(item.id),
  programDetails: (item) => String(item.programId),
};

/**
 * Definitions (gates, programs, program details) of the fragment whose ID the batch overlay already holds with other
 * content, where another issuer's fragment defines that ID: an issuer must not overwrite another's definition. (An ID
 * no other fragment defines is this issuer's own earlier definition, which a new fragment may replace.)
 */
export function definitionConflicts(
  overlay: OverlayFile | null,
  fragment: Pick<Fragment, DefinitionKind>,
  others: Pick<Fragment, DefinitionKind>[],
): string[] {
  const errors: string[] = [];
  for (const kind of ['gates', 'programs', 'programDetails'] as const) {
    const key = DEFINITION_KEY[kind];
    const existing = new Map(
      ((overlay?.[kind] ?? []) as Record<string, unknown>[]).map((item) => [key(item), item]),
    );
    const owned = new Set(others.flatMap((other) => (other[kind] as Record<string, unknown>[]).map(key)));
    (fragment[kind] as Record<string, unknown>[]).forEach((item, i) => {
      const id = key(item);
      if (existing.has(id) && owned.has(id) && !isDeepStrictEqual(existing.get(id), item))
        errors.push(`${kind}.${i}: ${id} is defined by another issuer's fragment with other content`);
    });
  }
  return errors;
}

/** The batch overlay and program mappings with the fragment merged in: the packet's cards replaced, definitions
 * replaced by ID (`definitionConflicts` refuses another issuer's ID first). */
export function mergeFragment(
  batch: Batch,
  overlay: OverlayFile | null,
  programs: { cards: { cardId: string }[] } | null,
  fragment: Fragment,
  cardIds: string[],
): { overlay: OverlayFile; rewardPrograms: { cards: { cardId: string }[] } } {
  const base: OverlayFile =
    overlay ??
    ({
      schemaVersion: 1,
      version: `${batch.id}.overlay.1`,
      annotationStatus: 'agent-verified',
      description: `Catalog overlay of pipeline batch ${batch.id}: one entry per corpus card, merged from the overlay/<issuer>.json fragments by pipeline accept overlay.`,
      programs: [],
      programDetails: [],
      gates: [],
      cards: [],
    } as OverlayFile);
  const byId = <T>(list: T[], add: T[], key: (item: T) => string) => {
    const ids = new Set(add.map(key));
    return [...list.filter((item) => !ids.has(key(item))), ...add];
  };
  const inPacket = new Set(cardIds);
  return {
    overlay: {
      ...base,
      gates: byId(base.gates, fragment.gates, (gate) => gate.id),
      programs: byId(base.programs, fragment.programs, (program) => program.id),
      programDetails: byId(base.programDetails, fragment.programDetails, (detail) => detail.programId),
      cards: [
        ...base.cards.filter((entry) => !inPacket.has(entry.cardId)),
        ...(fragment.cards as OverlayFile['cards']),
      ],
    },
    rewardPrograms: {
      ...(programs ?? {}),
      cards: [
        ...(programs?.cards ?? []).filter((card) => !inPacket.has(card.cardId)),
        ...fragment.rewardPrograms,
      ],
    },
  };
}

const readJsonOrNull = async <T>(path: string): Promise<T | null> => {
  const text = await readFile(path, 'utf8').catch(() => null);
  return text === null ? null : (JSON.parse(text) as T);
};

/** The definitions of the other issuers' fragments in overlay/ (unparseable ones count as defining nothing). */
async function otherFragments(batch: Batch, own: string): Promise<Pick<Fragment, DefinitionKind>[]> {
  const dir = join(batch.dir, 'overlay');
  const out: Pick<Fragment, DefinitionKind>[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) {
    if (!name.endsWith('.json') || join(dir, name) === own) continue;
    const parsed = overlayFragmentSchema.safeParse(await readJsonOrNull(join(dir, name)).catch(() => null));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Overlay: the fragment parses and covers exactly the packet's cards, each entry carries the corpusCaseSha256 of its
 * corpus case (milestone 1's pairing hash), the batch merged into the build's layers passes `checkOverlay` for the
 * issuer, the label-evidence lint passes, and the quote check passes. Returns the merged files to write on success.
 */
export async function overlayGate(
  batch: Batch,
  packet: Packet,
  data: unknown,
  dropped: Record<string, string>,
): Promise<{ errors: string[]; merged?: ReturnType<typeof mergeFragment> }> {
  const errors = envelopeGate(packet, data);
  const parsed = overlayFragmentSchema.safeParse(data);
  if (!parsed.success) return { errors: [...errors, ...zodErrors('', parsed.error)] };
  const fragment = parsed.data;
  const corpus = await readJsonOrNull<{ version: string; cases: CorpusCaseLike[] }>(
    join(batch.dir, 'corpus.json'),
  );
  if (!corpus) return { errors: [...errors, 'corpus.json: missing (run apply first)'] };
  const cases = corpusCases(corpus) as Map<string, CorpusCaseLike>;
  const inPacket = new Set(packet.cardIds);
  for (const entry of fragment.cards) {
    const at = `cards.${entry.cardId}`;
    if (!inPacket.has(entry.cardId)) errors.push(`${at}: outside the packet`);
    else if (entry.corpusCaseSha256 !== sha256Json(cases.get(entry.cardId)))
      errors.push(`${at}.corpusCaseSha256: not the SHA-256 of the card's corpus case`);
  }
  for (const cardId of packet.cardIds)
    if (!fragment.cards.some((entry) => entry.cardId === cardId))
      errors.push(`cards.${cardId}: no entry for a card of the packet`);
  for (const mapping of fragment.rewardPrograms)
    if (!inPacket.has(mapping.cardId)) errors.push(`rewardPrograms.${mapping.cardId}: outside the packet`);
  const overlay = await readJsonOrNull<OverlayFile>(join(batch.dir, 'catalog-overlay.json'));
  errors.push(...definitionConflicts(overlay, fragment, await otherFragments(batch, packet.output)));
  if (errors.length) return { errors };

  const merged = mergeFragment(
    batch,
    overlay,
    await readJsonOrNull<{ cards: { cardId: string }[] }>(join(batch.dir, 'reward-programs.json')),
    fragment,
    packet.cardIds,
  );
  errors.push(...(await overlayCoverage(batch, merged, packet.issuerName, dropped)));
  errors.push(
    ...lintOverlay(cases, merged.overlay, inPacket).map((finding) => `label lint: ${formatFinding(finding)}`),
  );
  errors.push(...(await quoteGate(batch)));
  return errors.length ? { errors } : { errors, merged };
}

/** `checkOverlay` for one issuer on the build's layers with this batch (merged overlay) as the newest layer. */
async function overlayCoverage(
  batch: Batch,
  merged: ReturnType<typeof mergeFragment>,
  issuerName: string,
  dropped: Record<string, string>,
): Promise<string[]> {
  try {
    const root = batch.root;
    const config = batchesConfigSchema.parse(
      JSON.parse(await readFile(join(root, BATCHES_CONFIG_PATH), 'utf8')),
    );
    const layers = [];
    for (const layer of config.layers)
      if (!(layer.kind === 'batch' && layer.id === batch.id)) layers.push(await loadLayer(root, layer));
    const corpus = JSON.parse(await readFile(join(batch.dir, 'corpus.json'), 'utf8'));
    const inCorpus = new Set(corpusCases(corpus).keys());
    layers.push({
      id: batch.id,
      kind: 'batch',
      dir: batch.rel,
      corpus,
      manifest: JSON.parse(await readFile(join(batch.dir, 'manifest.json'), 'utf8')),
      overlay: merged.overlay,
      notes: (await readJsonOrNull(join(batch.dir, 'product-notes.verified.json'))) ?? { cards: [] },
      // Cards still on their way (other issuers of the batch) are not this gate's business; build checks them all.
      cards: { cards: batch.cards.filter((card) => inCorpus.has(card.id) || dropped[card.id]) },
      rewardPrograms: merged.rewardPrograms.cards.length ? merged.rewardPrograms : null,
      dropped: Object.fromEntries(
        Object.entries(dropped).filter(([cardId]) => batch.cards.some((card) => card.id === cardId)),
      ),
    });
    const inputs = mergeLayers({
      config,
      layers,
      programTable: JSON.parse(await readFile(join(root, config.programTable), 'utf8')),
      merchants: JSON.parse(await readFile(join(root, config.merchants), 'utf8')),
    });
    const merchantSourceIds = new Set(
      (inputs.merchants.sources as { id: string }[]).map((source) => source.id),
    );
    const sources = (
      inputs.manifests as { sources: { id: string; capturedOn: string; checkedOn?: string }[] }[]
    ).flatMap((manifest) =>
      manifest.sources.map((source) => ({ id: source.id, checkedOn: source.checkedOn ?? source.capturedOn })),
    );
    const { verifiedAt, expiresAt } = catalogDates(sources, merchantSourceIds);
    const check = checkOverlay as unknown as (inputs: unknown, options: { issuers: string[] }) => string[];
    return check({ ...inputs, verifiedAt, expiresAt }, { issuers: [issuerName] }).map(
      (problem) => `overlay check: ${redact(problem)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n').map((line) => `overlay check: ${redact(line.replace(/^- /, ''))}`);
  }
}

/** The label lint at apply: checks a–c on the corpus rules of the given cards. */
export function applyLint(cases: Map<string, CorpusCaseLike>, cardIds: string[]): string[] {
  return cardIds.flatMap((cardId) => {
    const item = cases.get(cardId);
    return item ? lintCorpusCase(item).map((finding) => `label lint: ${formatFinding(finding)}`) : [];
  });
}
