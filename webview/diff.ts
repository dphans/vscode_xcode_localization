// Cell-level diff of the current catalog against the git HEAD baseline, for the
// in-grid "changed since commit" markers. We compare per (key, lang, variant)
// cell — a value change, a fresh translation, or a state-only change all count.

import type { Catalog, CatalogCell } from "../src/shared/xcstrings";

/** key → ("<lang>|<variantKey>" → cell) lookup built from the baseline catalog. */
export type Baseline = Map<string, Map<string, CatalogCell>>;

// "|" is safe: language codes (BCP 47) and variant keys (path joined by "/")
// never contain it, and the arbitrary entry key is the outer Map key (exact).
const inner = (lang: string, variantKey: string) => `${lang}|${variantKey}`;

export function buildBaseline(catalog: Catalog): Baseline {
  const map: Baseline = new Map();
  for (const entry of catalog.entries) {
    const cells = new Map<string, CatalogCell>();
    for (const row of entry.rows) {
      for (const lang of Object.keys(row.cells)) {
        const cell = row.cells[lang];
        if (cell) cells.set(inner(lang, row.variantKey), cell);
      }
    }
    map.set(entry.key, cells);
  }
  return map;
}

export function baselineCell(
  baseline: Baseline,
  key: string,
  lang: string,
  variantKey: string
): CatalogCell | undefined {
  return baseline.get(key)?.get(inner(lang, variantKey));
}

export type CellChange = "none" | "added" | "modified";

/** Compare a baseline cell with the current one. */
export function cellChange(
  base: CatalogCell | undefined,
  current: CatalogCell | undefined
): CellChange {
  const baseVal = base?.value ?? "";
  const curVal = current?.value ?? "";
  if (baseVal === curVal && base?.state === current?.state) return "none";
  // A fresh translation (was empty/absent → now has text) reads as "added".
  if (baseVal.trim() === "" && curVal.trim() !== "") return "added";
  return "modified"; // value change, cleared value, or state-only change
}
