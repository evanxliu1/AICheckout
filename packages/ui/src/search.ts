// Search matching for Combobox, kept apart from the component so it can be shared and tested.

export type ComboboxOption = {
  id: string;
  label: string;
  /** Options with the same group are listed together under the group's name, in first-seen order. */
  group?: string;
  /** Extra words that match a search but are not shown (a short name, an alias). */
  keywords?: string;
};

/** Lower case, accents and punctuation removed, so "cabelas" finds "Cabela's" and "&" equals "and". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every word of the query appears in the option's label, group or keywords (spaces ignored, so
 * "doublecash" finds "Double Cash"). */
export function matchesSearch(option: ComboboxOption, query: string): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const haystack = ` ${normalizeSearch(`${option.label} ${option.group ?? ''} ${option.keywords ?? ''}`)}`;
  const compact = haystack.replace(/ /g, '');
  return words.every((word) => haystack.includes(word) || compact.includes(word));
}
