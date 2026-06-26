// Translation progress per language.
//
// Denominator = total rows across keys that SHOULD be translated
// (shouldTranslate !== false). A "translated" cell = state "translated" with a
// non-empty value; "needs review" is counted separately; everything else (new,
// stale, empty, missing) is "remaining".

import type { Catalog } from "./xcstrings";

export interface LangProgress {
  translated: number;
  needsReview: number;
  remaining: number;
  total: number;
  /** 0..100, translated / total. */
  percent: number;
}

export function allLanguageProgress(
  catalog: Catalog
): Record<string, LangProgress> {
  const out: Record<string, LangProgress> = {};
  const targets = catalog.languages.filter((l) => l !== catalog.sourceLanguage);

  let total = 0;
  for (const e of catalog.entries) {
    if (!e.shouldTranslate) continue;
    total += e.rows.length;
  }

  for (const lang of targets) {
    let translated = 0;
    let needsReview = 0;
    for (const e of catalog.entries) {
      if (!e.shouldTranslate) continue;
      for (const row of e.rows) {
        const cell = row.cells[lang];
        if (cell?.state === "translated" && cell.value.trim() !== "") {
          translated++;
        } else if (cell?.state === "needs_review") {
          needsReview++;
        }
      }
    }
    out[lang] = {
      translated,
      needsReview,
      remaining: total - translated - needsReview,
      total,
      percent: total === 0 ? 0 : Math.round((translated / total) * 100),
    };
  }
  return out;
}
