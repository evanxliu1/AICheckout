/**
 * The project's curation configuration (decision 2026-10-02, wiki/decisions/2026-10-02-gpt-5-6-luna-for-curation.md):
 * gpt-5.6-luna at xhigh effort through the Codex CLI. `eval:v2 --provider codex` without `--model` and
 * `scripts/extract-cards.mjs` start from it; every flag still overrides its own part.
 *
 * xhigh reasoning needs two things the older Codex defaults lack: output tokens counted without hidden
 * reasoning (`visible`; ~10k reasoning tokens on a small card tripped the 8,192 output limit) and longer
 * local deadlines (about 3 minutes per case at p50).
 */
export const CURATION_DEFAULTS = {
  model: 'gpt-5.6-luna',
  effort: 'xhigh',
  prompt: 'guided.2',
  selection: 'keyword-window.1',
  codexOutputTokens: 'visible',
  attemptTimeoutMs: 600_000,
  totalTimeoutMs: 900_000,
} as const;
