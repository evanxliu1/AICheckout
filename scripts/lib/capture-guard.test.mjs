import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { keepExistingCapture } from './capture-guard.mjs';

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('a protected capture with another hash is kept; otherwise the capture is written', () => {
  const protectedIds = new Set(['a']);
  assert.equal(
    keepExistingCapture({ protectedIds, id: 'a', existingBody: 'old', newSha256: sha('new') }),
    true,
  );
  assert.equal(
    keepExistingCapture({ protectedIds, id: 'a', existingBody: 'old', newSha256: sha('old') }),
    false,
  );
  assert.equal(
    keepExistingCapture({ protectedIds, id: 'a', existingBody: null, newSha256: sha('new') }),
    false,
  );
  assert.equal(
    keepExistingCapture({ protectedIds, id: 'b', existingBody: 'old', newSha256: sha('new') }),
    false,
  );
});
