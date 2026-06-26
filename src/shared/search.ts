// Free-text search across keys, comments, and localization values (M5).
//
// Case-insensitive substring match. Scope = the key, the comment, and the
// values of the VISIBLE languages only (`langs` = source + displayed targets).
// "What you see is what you search": every result is explainable because the
// match is in a column that's actually on screen (so it gets highlighted). To
// search a hidden language, show its column first.
//
// Note: matching lowercases both sides. For the languages this tool targets
// (Latin/Vietnamese/CJK) lowercasing is index-preserving, so the ranges from
// findRanges map back onto the original text. A few exotic casings (ß, İ) would
// shift indices; not worth handling for UI-string search.

import type { CatalogEntry } from "./xcstrings";

export function entryMatchesQuery(
  entry: CatalogEntry,
  query: string,
  langs: string[]
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.key.toLowerCase().includes(q)) return true;
  if (entry.comment && entry.comment.toLowerCase().includes(q)) return true;
  for (const row of entry.rows) {
    for (const lang of langs) {
      const value = row.cells[lang]?.value;
      if (value && value.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

export function searchEntries(
  entries: CatalogEntry[],
  query: string,
  langs: string[]
): CatalogEntry[] {
  if (!query.trim()) return entries;
  return entries.filter((e) => entryMatchesQuery(e, query, langs));
}

/** Ranges [start, end) of every `query` occurrence in `text` (case-insensitive). */
export function findRanges(
  text: string,
  query: string
): Array<[number, number]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hay = text.toLowerCase();
  const out: Array<[number, number]> = [];
  let i = hay.indexOf(q);
  while (i !== -1) {
    out.push([i, i + q.length]);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}
