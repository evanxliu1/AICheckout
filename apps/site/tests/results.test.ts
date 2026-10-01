import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { percent, resultRows, resultsFile } from '../src/results';

const markdown = readFileSync(new URL('../../../docs/evals/results.md', import.meta.url), 'utf8');

it('derives one row per complete configuration from results.json', () => {
  const rows = resultRows();
  const complete = resultsFile.runs.filter((run) => run.complete && !run.rejected);
  expect(rows).toHaveLength(complete.length);
  expect(rows.filter((row) => row.split === 'heldout').length).toBeGreaterThan(0);
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
});

it('matches the published write-up for every configuration', () => {
  // Each row of results.md's tables starts "| model | prompt | selection | runs | field acc. | rule recall".
  for (const row of resultRows()) {
    const line = `| ${row.model} | ${row.prompt} | ${row.selection} | ${row.runs} | ${percent(row.fieldAccuracy)} | ${percent(row.ruleRecall)} |`;
    expect(markdown, `${row.id}`).toContain(line);
  }
});

it('marks the run added after the held-out choice', () => {
  const added = resultRows().filter((row) => row.addedAfter);
  expect(added.map((row) => row.id)).toEqual(resultsFile.addedAfter);
  expect(added.every((row) => row.split === 'heldout' && row.model.startsWith('claude-opus'))).toBe(true);
});
