// The capture gate's no-overwrite rule (wiki/system/card-expansion-pipeline.md, "Gates"): a protected source whose
// existing capture has another hash is never overwritten; the new text is discarded and the run reports the source as
// failed (`changed-capture-kept`), so the pipeline queues it as capture-flagged. Used by capture-issuer-pages.mjs
// --protect; without --protect nothing changes.
import { createHash } from 'node:crypto';

export const CHANGED_CAPTURE_KEPT = 'changed-capture-kept';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** True when the new capture text must not replace the existing one. */
export function keepExistingCapture({ protectedIds, id, existingBody, newSha256 }) {
  return protectedIds.has(id) && existingBody !== null && sha256(existingBody) !== newSha256;
}
