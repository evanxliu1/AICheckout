// The mechanical anchor rebase (design rule 3, "Anchor-only change"): when a re-draft moved only anchors (labels
// hash unchanged), the findings' `current` values on anchor paths are re-pointed to the new draft's values and the
// verification stands. Apply then re-runs (its input, the full draft case, changed) and its `--check` gate checks
// every `current` again. Paths that no longer exist in the new draft are reported, not guessed.
import { readFile } from 'node:fs/promises';
import { deriveBatch } from './derive.ts';
import { findingsFileSchema, loadBatch, statePath } from './files.ts';
import { isAnchorPath } from './hash.ts';
import { draftSplit } from './inputs.ts';
import { writeJsonAtomic, writeState } from './state.ts';
import type { Env } from './run.ts';

/** The value at a dotted findings path (`reference.rules.1.anchors.0`) in a draft case, or undefined. */
export function valueAt(root: unknown, path: string): unknown {
  let node = root;
  for (const part of path.split('.')) {
    if (Array.isArray(node) && /^\d+$/.test(part)) node = node[Number(part)];
    else if (node !== null && typeof node === 'object' && Object.hasOwn(node, part))
      node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

export interface RebaseResult {
  rebased: string[];
  fixesChanged: number;
  unresolved: { cardId: string; path: string }[];
}

export async function rebaseAnchors(env: Env, batchId: string): Promise<RebaseResult> {
  const batch = await loadBatch(env.root, batchId);
  const view = await deriveBatch(batch, env.now());
  const result: RebaseResult = { rebased: [], fixesChanged: 0, unresolved: [] };
  const byFile = new Map<string, string[]>();
  for (const card of view.cards.filter((entry) => entry.rebaseAnchors)) {
    const findings = batch.findings.get(card.cardId);
    if (!findings) continue;
    byFile.set(findings.file, [...(byFile.get(findings.file) ?? []), card.cardId]);
  }
  for (const [file, cardIds] of byFile) {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { cards: Record<string, unknown>[] };
    findingsFileSchema.parse(raw);
    const ok: string[] = [];
    for (const entry of raw.cards) {
      const cardId = entry.cardId as string;
      if (!cardIds.includes(cardId)) continue;
      const draft = batch.draft.get(cardId);
      const fixes = (entry.fixes ?? []) as { path: string; current?: unknown }[];
      const changes: [{ current?: unknown }, unknown][] = [];
      let unresolved = false;
      for (const fix of fixes) {
        if (!isAnchorPath(fix.path)) continue;
        const value = valueAt(draft, fix.path);
        if (value === undefined) {
          result.unresolved.push({ cardId, path: fix.path });
          unresolved = true;
        } else changes.push([fix, value]);
      }
      if (unresolved) continue;
      for (const [fix, value] of changes)
        if (JSON.stringify(fix.current) !== JSON.stringify(value)) {
          fix.current = value;
          result.fixesChanged++;
        }
      ok.push(cardId);
    }
    if (ok.length) await writeJsonAtomic(file, raw);
    for (const cardId of ok) {
      const verify = batch.state.cards[cardId]?.stages.verify;
      const split = draftSplit(batch, cardId);
      if (verify && split) verify.anchorsHash = split.anchorsHash;
      result.rebased.push(cardId);
    }
  }
  await writeState(statePath(batch.dir), batch.state, env.now());
  return result;
}
