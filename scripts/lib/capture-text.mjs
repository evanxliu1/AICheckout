// The capture stage's text normalization and quality gates, shared by capture-issuer-pages.mjs (headless Chromium)
// and `pipeline capture-import` (text read from a page in the Claude desktop app's browser pane), so an imported
// capture is normalized, hashed and flagged exactly like a scripted one (wiki/system/card-pipeline-commands.md).
import { createHash } from 'node:crypto';

/** Pages that are not the issuer's terms: an access-denied or challenge page in the first 3,000 characters. */
export const BOT_WALL =
  /access denied|captcha|unusual (traffic|activity)|are you a robot|request (was )?blocked|verify you are human|enable javascript to/i;

/** A capture shorter than this is flagged `short`. */
export const SHORT_CAPTURE = 2000;

/** Line endings to \n, trailing spaces dropped, runs of blank lines collapsed. Words are left exactly as rendered. */
export const normalizeCaptureText = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';

/** The quality flags of a normalized capture and its HTTP status (`HTTP <n>`, `short`, `bot-wall?`). */
export function captureFlags(text, status) {
  const flags = [];
  if (status >= 400) flags.push(`HTTP ${status}`);
  if (text.length < SHORT_CAPTURE) flags.push('short');
  if (BOT_WALL.test(text.slice(0, 3000))) flags.push('bot-wall?');
  return flags;
}

export const captureSha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
