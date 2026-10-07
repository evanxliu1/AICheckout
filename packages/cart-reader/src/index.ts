// Generic cart reader (Phase 13). Contract: docs/evals/generic-reader-protocol.md and
// wiki/system/merchant-coverage-design.md#generic-cart-reader. `readCart` is deterministic and synchronous; it reads
// only the document it is given (open shadow roots included), never the network, a model, storage or the clock, and
// never the rebuild's `data-pane-*` attributes or any per-domain list. It shows an amount only when certain and
// otherwise withholds. The evaluation harness is evals/reader/.
//
// This is the placeholder of 2026-10-07: it always withholds. The rules are written later by the reader developer,
// on development pages only.
import type { CartReading, ReadOptions } from './types.ts';

export type { CartReading, ReadOptions, ReadingKind, ShownReading, WithheldReading } from './types.ts';
export { READING_KINDS } from './types.ts';

export function readCart(document: Document, options: ReadOptions): CartReading {
  void document;
  void options;
  return { shown: false, reason: 'not-implemented' };
}
