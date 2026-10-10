// Public surface of the generic cart reader: the reader (reader.ts) and the cart page detector (detect.ts).
export type {
  CartReading,
  DetectOptions,
  PageDetection,
  PageKind,
  ReadOptions,
  ReadingKind,
  ShownReading,
  WithheldReading,
} from './types.ts';
export { PAGE_KINDS, READING_KINDS } from './types.ts';
export { explainCart, readCart } from './reader.ts';
export type { RowReport } from './reader.ts';
export { cartUrlHint, detectCartPage, readCartPage } from './detect.ts';
