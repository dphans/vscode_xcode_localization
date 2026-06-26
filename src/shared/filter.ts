// Row filtering for the grid (by translation state / format warnings).
//
// Filters are evaluated against the CURRENTLY DISPLAYED target languages: an
// entry matches if any of its rows has a matching displayed-target cell. Keys
// marked `shouldTranslate: false` are skipped by every non-"all" filter.

import { diffSpecifiers } from "./format";
import type { CatalogEntry } from "./xcstrings";

export type RowFilter =
  | "all"
  | "untranslated"
  | "needs_review"
  | "warnings"
  | "orphaned";

export function entryMatchesFilter(
  entry: CatalogEntry,
  sourceLanguage: string,
  targets: string[],
  filter: RowFilter,
  /** Whether the key may stand in as the source value (xcstrings); when false
   * (.strings) format warnings only compare against a real source value. */
  keyAsSource = true
): boolean {
  if (filter === "all") return true;
  if (!entry.shouldTranslate) return false;

  for (const row of entry.rows) {
    const sourceValue = keyAsSource
      ? row.cells[sourceLanguage]?.value ?? entry.key
      : row.cells[sourceLanguage]?.value;
    for (const lang of targets) {
      const cell = row.cells[lang];
      const value = cell?.value ?? "";
      const empty = value.trim() === "";

      switch (filter) {
        case "untranslated":
          if (!cell || empty || cell.state === "new" || cell.state === "stale") {
            return true;
          }
          break;
        case "needs_review":
          if (cell?.state === "needs_review") return true;
          break;
        case "warnings":
          if (!empty && sourceValue !== undefined && !diffSpecifiers(sourceValue, value).ok) {
            return true;
          }
          break;
        case "orphaned":
          // A key present in this (target) file but absent from the source
          // language — likely removed upstream and left behind. Only meaningful
          // when there's a real source column to be missing from.
          if (sourceLanguage !== "" && row.cells[sourceLanguage] === undefined) {
            return true;
          }
          break;
      }
    }
  }
  return false;
}

export function filterEntries(
  entries: CatalogEntry[],
  sourceLanguage: string,
  targets: string[],
  filter: RowFilter,
  keyAsSource = true
): CatalogEntry[] {
  if (filter === "all") return entries;
  return entries.filter((e) =>
    entryMatchesFilter(e, sourceLanguage, targets, filter, keyAsSource)
  );
}

export interface FilterCounts {
  all: number;
  untranslated: number;
  needs_review: number;
  warnings: number;
  orphaned: number;
}

/**
 * Count how many entries match each filter (same scope as filterEntries: the
 * displayed target languages, skipping `shouldTranslate: false`). Pass the
 * already-searched entries to get counts under the active search — each count
 * equals the number of rows that filter would show right now.
 */
export function filterCounts(
  entries: CatalogEntry[],
  sourceLanguage: string,
  targets: string[],
  keyAsSource = true
): FilterCounts {
  let untranslated = 0;
  let needs_review = 0;
  let warnings = 0;
  let orphaned = 0;
  for (const e of entries) {
    if (entryMatchesFilter(e, sourceLanguage, targets, "untranslated", keyAsSource)) {
      untranslated++;
    }
    if (entryMatchesFilter(e, sourceLanguage, targets, "needs_review", keyAsSource)) {
      needs_review++;
    }
    if (entryMatchesFilter(e, sourceLanguage, targets, "warnings", keyAsSource)) {
      warnings++;
    }
    if (entryMatchesFilter(e, sourceLanguage, targets, "orphaned", keyAsSource)) {
      orphaned++;
    }
  }
  return { all: entries.length, untranslated, needs_review, warnings, orphaned };
}
