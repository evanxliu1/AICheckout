import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureFlags, captureSha256, normalizeCaptureText } from './capture-text.mjs';

test('normalizeCaptureText keeps words and fixes line ends, trailing spaces and blank runs', () => {
  assert.equal(normalizeCaptureText('  a  \r\nb\t\r\r\n\n\n\nc  '), 'a\nb\n\nc\n');
});

test('captureFlags reports HTTP errors, short pages and bot walls in the script order', () => {
  assert.deepEqual(captureFlags('Access Denied\n', 403), ['HTTP 403', 'short', 'bot-wall?']);
  assert.deepEqual(captureFlags(`${'terms '.repeat(400)}\n`, 200), []);
  assert.equal(captureSha256('a\n'), createHash('sha256').update('a\n', 'utf8').digest('hex'));
});
