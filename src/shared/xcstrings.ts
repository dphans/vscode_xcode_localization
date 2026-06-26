// Model + parser for .xcstrings (String Catalog) files.
//
// Goal (M1): read the JSON text → a FLAT model for rendering the grid.
// Each key may have a single cell (stringUnit) or several "variants"
// (variations: plural one/other/…, device iphone/ipad/mac, or nested). We
// collect every leaf stringUnit into "rows", taking the UNION of variants
// across all languages so they can be shown side by side.
//
// This parser deliberately does NOT touch the original key order/whitespace —
// writing the file back to match Xcode is the editor's job (see shared/edit).
// Here we only read.

/** A single state/value leaf in .xcstrings (the smallest editable unit). */
export interface CatalogCell {
  state?: string;
  value: string;
}

/** One grid row: corresponds to a single variant path, spanning languages. */
export interface CatalogRow {
  /** Variant key (the jsonc path joined by "/"), "" for the base stringUnit. */
  variantKey: string;
  /** Display label, "" for a single cell. E.g. "plural · other", "count · plural · one". */
  variantLabel: string;
  /**
   * Relative jsonc key path from the localization node to the variation node
   * (excluding "stringUnit"), reused verbatim when editing. Examples:
   * [], ["variations","plural","other"],
   * ["substitutions","count","variations","plural","one"].
   */
  segments: string[];
  /** lang → cell (undefined if that language has no such variant). */
  cells: Record<string, CatalogCell | undefined>;
}

/** A key in the catalog, which may span several rows (variants). */
export interface CatalogEntry {
  key: string;
  comment?: string;
  extractionState?: string;
  /** False when the key is marked `shouldTranslate: false` in the catalog. */
  shouldTranslate: boolean;
  /** True if the key uses %#@…@ substitutions (M1 just flags it). */
  hasSubstitutions: boolean;
  rows: CatalogRow[];
}

/** The whole parsed catalog. */
export interface Catalog {
  sourceLanguage: string;
  version: string;
  /** Every language seen; the source language first, the rest sorted a→z. */
  languages: string[];
  entries: CatalogEntry[];
  /** Error message if the JSON is broken (other fields are then empty). */
  error?: string;
  /** Parsed fine, but the JSON isn't a String Catalog (no `strings` table) —
   * distinct from a genuinely empty catalog. */
  notCatalog?: boolean;
}

// Raw JSON shape (only the parts we touch are declared). A substitution value
// ({ formatSpecifier, argNum?, variations }) is structurally a RawNode too (its
// `variations` is what we recurse into), so we type it as such.
interface RawNode {
  stringUnit?: { state?: string; value?: string };
  variations?: Record<string, Record<string, RawNode>>;
  substitutions?: Record<string, RawNode>;
}

interface RawLocalization extends RawNode {}

interface RawString {
  comment?: string;
  extractionState?: string;
  shouldTranslate?: boolean;
  localizations?: Record<string, RawLocalization>;
}

interface RawCatalog {
  sourceLanguage?: string;
  version?: string;
  strings?: Record<string, RawString>;
}

/**
 * A collected leaf: its jsonc `path` (the relative keys from the localization
 * node down to the variation node, excluding "stringUnit"), a human `label`
 * path, and the cell. Examples:
 *   - template stringUnit:   path [], label []
 *   - direct plural "one":   path ["variations","plural","one"], label ["plural","one"]
 *   - substitution form:     path ["substitutions","count","variations","plural","one"],
 *                            label ["count","plural","one"]
 */
interface Leaf {
  path: string[];
  labelParts: string[];
  cell: CatalogCell;
}

/**
 * Recursively collect every editable stringUnit reachable from a node. A node
 * may carry SEVERAL at once (e.g. a template stringUnit + substitutions), so we
 * accumulate rather than return early:
 * - stringUnit            → a leaf at the current path,
 * - variations            → recurse into each (dimension, case) (device→plural
 *                           may be nested),
 * - substitutions         → recurse into each named substitution (its inner
 *                           variations become the leaves).
 */
function collectLeaves(
  node: RawNode,
  path: string[],
  labelParts: string[]
): Leaf[] {
  const out: Leaf[] = [];

  if (node.stringUnit) {
    out.push({
      path: [...path],
      labelParts: [...labelParts],
      cell: {
        state: node.stringUnit.state,
        value: node.stringUnit.value ?? "",
      },
    });
  }

  if (node.variations) {
    for (const [dimension, cases] of Object.entries(node.variations)) {
      if (!cases) continue;
      for (const [caseName, caseNode] of Object.entries(cases)) {
        if (!caseNode) continue;
        out.push(
          ...collectLeaves(
            caseNode,
            [...path, "variations", dimension, caseName],
            [...labelParts, dimension, caseName]
          )
        );
      }
    }
  }

  if (node.substitutions) {
    for (const [name, sub] of Object.entries(node.substitutions)) {
      if (!sub) continue;
      out.push(
        ...collectLeaves(
          sub,
          [...path, "substitutions", name],
          [...labelParts, name]
        )
      );
    }
  }

  return out;
}

/** Heuristic: a String Catalog is a JSON object carrying a `strings` map (Xcode
 * always writes it, even when empty). Lets us tell "wrong file" from "empty". */
function looksLikeCatalog(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const strings = (data as Record<string, unknown>).strings;
  return (
    typeof strings === "object" && strings !== null && !Array.isArray(strings)
  );
}

/**
 * Parse .xcstrings text into a {@link Catalog}.
 * Never throws: broken JSON returns an empty Catalog with `error` set; valid
 * JSON that isn't a catalog returns one with `notCatalog` set.
 */
export function parseCatalog(text: string): Catalog {
  const empty: Catalog = {
    sourceLanguage: "",
    version: "",
    languages: [],
    entries: [],
  };

  if (!text.trim()) return empty;

  let data: RawCatalog;
  try {
    data = JSON.parse(text) as RawCatalog;
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }

  if (!looksLikeCatalog(data)) {
    return { ...empty, notCatalog: true };
  }

  const sourceLanguage = data.sourceLanguage ?? "";
  const version = data.version ?? "";
  const strings = data.strings ?? {};

  const langSet = new Set<string>();
  const entries: CatalogEntry[] = [];

  // Preserve the key order from the file (Object.keys follows JSON insertion order).
  for (const key of Object.keys(strings)) {
    const raw = strings[key] ?? {};
    const localizations = raw.localizations ?? {};

    // Collect leaves per language while building the UNION of variant paths.
    // The variant key is the jsonc path joined by "/" — stable + unique across
    // direct variations and substitution forms.
    const perLangLeaves: Record<string, Map<string, Leaf>> = {};
    const variantOrder: string[] = [];
    const variantSeen = new Set<string>();
    const pathByVariant: Record<string, string[]> = {};
    const labelByVariant: Record<string, string> = {};
    let hasSubstitutions = false;

    for (const lang of Object.keys(localizations)) {
      langSet.add(lang);
      const node = localizations[lang] ?? {};
      if (node.substitutions) hasSubstitutions = true;

      const leaves = collectLeaves(node, [], []);
      const map = new Map<string, Leaf>();
      for (const leaf of leaves) {
        const vKey = leaf.path.join("/");
        map.set(vKey, leaf);
        if (!variantSeen.has(vKey)) {
          variantSeen.add(vKey);
          variantOrder.push(vKey);
          pathByVariant[vKey] = leaf.path;
          labelByVariant[vKey] = leaf.labelParts.join(" · ");
        }
      }
      perLangLeaves[lang] = map;
    }

    // If the key is entirely empty (no localizations) still create one empty row.
    const variants = variantOrder.length > 0 ? variantOrder : [""];
    if (variantOrder.length === 0) {
      pathByVariant[""] = [];
      labelByVariant[""] = "";
    }

    // A key with several rows but a path-[] "template" row (substitution case):
    // label that template "base" so it isn't a blank row among the forms.
    const multi = variants.length > 1;

    const rows: CatalogRow[] = variants.map((vKey) => {
      const segments = pathByVariant[vKey] ?? [];
      let variantLabel = labelByVariant[vKey] ?? "";
      if (multi && variantLabel === "") variantLabel = "base";
      const cells: Record<string, CatalogCell | undefined> = {};
      for (const lang of Object.keys(localizations)) {
        cells[lang] = perLangLeaves[lang]?.get(vKey)?.cell;
      }
      return { variantKey: vKey, variantLabel, segments, cells };
    });

    entries.push({
      key,
      comment: raw.comment,
      extractionState: raw.extractionState,
      shouldTranslate: raw.shouldTranslate !== false,
      hasSubstitutions,
      rows,
    });
  }

  // Languages: source first, the rest a→z.
  const others = [...langSet].filter((l) => l !== sourceLanguage).sort();
  const languages = sourceLanguage
    ? [sourceLanguage, ...others]
    : [...langSet].sort();

  return { sourceLanguage, version, languages, entries };
}

// ---- State helpers (used by the progress badge) ----

export type KnownState = "translated" | "new" | "needs_review" | "stale";

/** Short human label for a state. */
export function stateLabel(state?: string): string {
  switch (state) {
    case "translated":
      return "translated";
    case "new":
      return "new";
    case "needs_review":
      return "needs review";
    case "stale":
      return "stale";
    default:
      return state ?? "—";
  }
}
