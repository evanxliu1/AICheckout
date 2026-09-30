import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyRun,
  configurationMismatch,
  evalArgs,
  parseMatrix,
  planRuns,
  retriableCount,
  slugFor,
} from './eval-matrix.mjs';

const matrix = () =>
  parseMatrix({
    split: 'dev',
    configurations: [
      {
        provider: 'codex',
        model: 'gpt-5.5',
        effort: 'low',
        prompt: 'guided.1',
        selection: 'full',
        repeat: 2,
      },
      { provider: 'claude', model: 'claude-sonnet-5', prompt: 'baseline.1', selection: 'keyword-window.1' },
    ],
  });

test('slugs are deterministic and filesystem-safe', () => {
  const m = matrix();
  assert.equal(m.configurations[0].slug, 'codex.gpt-5.5.low.guided.1.full.dev');
  assert.equal(m.configurations[1].slug, 'claude.claude-sonnet-5.low.baseline.1.keyword-window.1.dev');
  assert.equal(
    slugFor({ provider: 'x', model: 'A/B C', prompt: 'p', selection: 's' }, 'heldout'),
    'x.a-b-c.default.p.s.heldout',
  );
});

test('parseMatrix validates rows and rejects duplicates', () => {
  assert.throws(() => parseMatrix({ configurations: [] }), /non-empty/);
  assert.throws(() => parseMatrix({ configurations: [{ provider: 'codex' }] }), /model is required/);
  assert.throws(() => parseMatrix({ split: 'all', configurations: [] }), /dev or heldout/);
  const row = { provider: 'codex', model: 'm', prompt: 'p', selection: 's' };
  assert.throws(() => parseMatrix({ configurations: [row, { ...row }] }), /Duplicate/);
  assert.throws(() => parseMatrix({ configurations: [{ ...row, repeat: 11 }] }), /repeat/);
  assert.equal(parseMatrix({ configurations: [row] }).output, 'evals/curation/runs/matrix');
});

test('evalArgs builds a fresh run or a resume, guarding held-out', () => {
  const m = matrix();
  assert.deepEqual(evalArgs(m.configurations[0], 'dev', 'out/a'), [
    '--provider',
    'codex',
    '--model',
    'gpt-5.5',
    '--effort',
    'low',
    '--prompt',
    'guided.1',
    '--selection',
    'full',
    '--split',
    'dev',
    '--repeat',
    '2',
    '--output',
    'out/a',
    '--concurrency',
    '3',
  ]);
  assert.deepEqual(evalArgs(m.configurations[1], 'heldout', 'out/b', { resume: true, corpus: 'c' }), [
    '--resume',
    'out/b',
    '--allow-heldout',
    '--concurrency',
    '3',
    '--corpus',
    'c',
  ]);
  assert.ok(evalArgs(m.configurations[1], 'dev', 'out/b').includes('--effort'));
});

test('planRuns skips complete runs, resumes partial or retriable ones, flags mismatches, filters', () => {
  const m = matrix();
  const cfg = {
    provider: { id: 'codex-cli', model: 'gpt-5.5' },
    effort: 'low',
    prompt: 'guided.1',
    selection: 'full',
    split: 'dev',
    repeat: 2,
  };
  const saved = new Map([
    [
      m.configurations[0].slug,
      { complete: false, observed: 5, planned: 40, retriable: 0, configuration: cfg },
    ],
  ]);
  assert.deepEqual(
    planRuns(m, saved).map((p) => [p.configuration.slug, p.action, p.observed]),
    [
      [m.configurations[0].slug, 'resume', 5],
      [m.configurations[1].slug, 'run', 0],
    ],
  );
  saved.set(m.configurations[0].slug, {
    complete: true,
    observed: 40,
    planned: 40,
    retriable: 0,
    configuration: cfg,
  });
  assert.equal(planRuns(m, saved)[0].action, 'skip');
  saved.set(m.configurations[0].slug, {
    complete: true,
    observed: 40,
    planned: 40,
    retriable: 3,
    configuration: cfg,
  });
  assert.equal(planRuns(m, saved)[0].action, 'resume');
  saved.set(m.configurations[0].slug, {
    complete: true,
    observed: 40,
    planned: 40,
    retriable: 0,
    configuration: { ...cfg, repeat: 1 },
  });
  assert.equal(planRuns(m, saved)[0].action, 'mismatch');
  assert.deepEqual(planRuns(m, saved)[0].mismatch, ['repeat']);
  assert.deepEqual(
    planRuns(m, saved, { provider: 'claude' }).map((p) => p.configuration.provider),
    ['claude'],
  );
  assert.equal(planRuns(m, saved, { only: 'gpt-5.5' }).length, 1);
});

test('configurationMismatch compares every configuration field', () => {
  const m = matrix();
  const cfg = {
    provider: { id: 'claude-cli', model: 'claude-sonnet-5' },
    effort: 'low',
    prompt: 'baseline.1',
    selection: 'keyword-window.1',
    split: 'dev',
    repeat: 1,
  };
  assert.deepEqual(configurationMismatch(m.configurations[1], 'dev', cfg), []);
  assert.deepEqual(configurationMismatch(m.configurations[1], 'heldout', { ...cfg, prompt: 'guided.1' }), [
    'prompt',
    'split',
  ]);
});

test('classifyRun distinguishes usage limits, rejected models, and completion', () => {
  assert.equal(classifyRun(3, undefined), 'rate-limited');
  assert.equal(classifyRun(1, undefined), 'failed');
  assert.equal(
    classifyRun(0, { complete: true, observed: 40, overall: { statuses: { needs_review: 40 } } }),
    'complete',
  );
  assert.equal(
    classifyRun(1, { complete: false, observed: 10, overall: { statuses: { needs_review: 10 } } }),
    'incomplete',
  );
  assert.equal(
    classifyRun(0, { complete: true, observed: 40, overall: { statuses: { provider_error: 40 } } }),
    'rejected',
  );
});

test('classifyRun keeps a run incomplete while harness failures may be retried', () => {
  const h = (failed, retriable, statuses) => ({
    complete: true,
    observed: 40,
    harness: { failed, retriable },
    overall: { statuses },
  });
  assert.equal(classifyRun(1, h(2, 2, { needs_review: 38, timeout: 2 })), 'incomplete');
  assert.equal(classifyRun(0, h(2, 0, { needs_review: 38, timeout: 2 })), 'complete');
  assert.equal(classifyRun(1, h(40, 40, { provider_error: 40 })), 'incomplete');
  assert.equal(classifyRun(0, h(40, 0, { provider_error: 40 })), 'rejected');
});

test('retriableCount counts harness failures below the per-slot retry cap', () => {
  const o = (caseId, repeat, status, runId) => ({ caseId, repeat, trace: { status, runId } });
  const observations = [
    o('a', 1, 'timeout', 'r1'),
    o('a', 2, 'provider_error', 'r2'),
    o('b', 1, 'needs_review', 'r3'),
    o('c', 1, 'timeout', 'r4'),
  ];
  assert.equal(retriableCount(observations, []), 3);
  const log = [
    { slot: 'a#1', runId: 'x1' },
    { slot: 'a#1', runId: 'x2' },
    { slot: 'a#1', runId: 'x2' },
    { slot: 'c#1', runId: 'y1' },
  ];
  assert.equal(retriableCount(observations, log), 2);
});
