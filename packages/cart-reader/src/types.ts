/** Kinds of summary total, in preference order (generic-reader-protocol, Label schema). */
export const READING_KINDS = ['afterCredit', 'estimatedTotal', 'subtotal'] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

/** The reader shows one amount it is certain of: its kind, integer minor units and ISO 4217 currency. */
export type ShownReading = {
  shown: true;
  kind: ReadingKind;
  amountMinor: number;
  currency: string;
};
/** Or it withholds, with a short machine reason (no page text). */
export type WithheldReading = { shown: false; reason: string };
export type CartReading = ShownReading | WithheldReading;

export type ReadOptions = {
  /** The page's URL. The reader may use it (the TLD included); it never fetches it. */
  url: string;
};

/** What a page is to the shopper: their cart (or basket, bag), a checkout step, or neither (Phase 13c). */
export const PAGE_KINDS = ['cart', 'checkout', 'none'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
/** The detector's verdict with a short machine reason (no page text). */
export type PageDetection = { page: PageKind; reason: string };
export type DetectOptions = ReadOptions;
