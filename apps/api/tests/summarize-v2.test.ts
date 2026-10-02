import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runEvaluationV2Cli } from '../src/curation/v2/eval-cli.ts';
import { summarizeRuns } from '../src/curation/v2/summarize.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../evals/curation/fixture.v2');

it('re-scores saved run directories from their observations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'summarize-v2-'));
  const root = resolve(import.meta.dirname, '../../..');
  try {
    const common = ['--corpus', FIXTURE, '--prompt', 'guided.1', '--selection', 'full'];
    await runEvaluationV2Cli([...common, '--output', join(dir, 'echo')], root);
    await runEvaluationV2Cli(
      [...common, '--model', 'abstain.2', '--limit', '2', '--output', join(dir, 'abstain')],
      root,
    );
    process.exitCode = 0;
    const summary = await summarizeRuns(FIXTURE, [dir]);
    expect(summary.corpus.version).toBe('fixture.v2.1');
    expect(summary.rows.map((r) => r.id)).toEqual(['abstain', 'echo']);
    const [abstain, echo] = summary.rows;
    expect(echo).toMatchObject({
      model: 'reference-echo.1',
      prompt: 'guided.1',
      split: 'dev',
      complete: true,
      rejected: false,
      harness: { failed: 0, retriable: 0, attempts: 0 },
      labelsCollectedWith: [summary.corpus.hash],
      cliVersions: ['unrecorded'],
    });
    expect(echo.overall.endToEndFieldAccuracy.rate).toBe(1);
    expect(echo.promptTokenEstimate).toBeGreaterThan(0);
    expect(abstain).toMatchObject({ model: 'abstain.2', observed: 2, complete: false });
    expect(abstain.overall.ruleRecall.rate).toBe(0);
    expect(abstain.errors.missedRules).not.toEqual({});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('reports a run over both splits as one row per split', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'summarize-v2-'));
  const root = resolve(import.meta.dirname, '../../..');
  try {
    await runEvaluationV2Cli(
      ['--corpus', FIXTURE, '--split', 'all', '--allow-heldout', '--output', join(dir, 'echo.all')],
      root,
    );
    process.exitCode = 0;
    const summary = await summarizeRuns(FIXTURE, [dir]);
    expect(
      summary.rows.map(({ id, split, planned, observed, complete }) => ({
        id,
        split,
        planned,
        observed,
        complete,
      })),
    ).toEqual([
      { id: 'echo.dev', split: 'dev', planned: 5, observed: 5, complete: true },
      { id: 'echo.heldout', split: 'heldout', planned: 3, observed: 3, complete: true },
    ]);
    expect(summary.rows.every((r) => r.overall.endToEndFieldAccuracy.rate === 1)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
