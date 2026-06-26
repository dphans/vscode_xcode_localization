// Build the shared `Catalog` model from `.strings` files so the existing webview
// (Grid, filter, search, progress) renders them unchanged. A `.strings` editor
// shows the source language (read-only) + the opened file's language (editable),
// each key as a single row.

import * as vscode from "vscode";
import type { Catalog, CatalogCell, CatalogEntry } from "../shared/xcstrings";
import { parseStrings, type StringsEntry } from "../shared/strings";
import type { LprojGroup } from "./lproj";

/**
 * @param activeText  text of the opened file (the active TextDocument)
 * @param activeLang  the opened file's language (its `.lproj`)
 * @param group       the resolved sibling group
 * @param sourceLang  the detected source language (may equal activeLang)
 */
export async function buildStringsCatalog(
  activeText: string,
  activeLang: string,
  group: LprojGroup,
  sourceLang: string
): Promise<Catalog> {
  const active = parseStrings(activeText);

  // Read the source sibling via openTextDocument (NOT fs.readFile) so VSCode
  // decodes the encoding (UTF-16/BOM) and we see any live unsaved edits.
  let sourceEntries: StringsEntry[] = [];
  let hasSource = !!sourceLang && sourceLang !== activeLang;
  if (hasSource) {
    const srcFile = group.files.find((f) => f.lang === sourceLang);
    if (srcFile) {
      try {
        const doc = await vscode.workspace.openTextDocument(srcFile.uri);
        sourceEntries = parseStrings(doc.getText()).entries;
      } catch {
        hasSource = false; // unreadable → no source column
      }
    } else {
      hasSource = false;
    }
  }
  const effectiveSource = hasSource ? sourceLang : "";

  // Key order: source order first, then any active-only keys. Values: last-wins
  // (Cocoa keeps the last duplicate).
  const order: string[] = [];
  const seen = new Set<string>();
  const srcByKey = new Map<string, StringsEntry>();
  for (const e of sourceEntries) {
    srcByKey.set(e.key, e);
    if (!seen.has(e.key)) {
      seen.add(e.key);
      order.push(e.key);
    }
  }
  const actByKey = new Map<string, StringsEntry>();
  for (const e of active.entries) {
    actByKey.set(e.key, e);
    if (!seen.has(e.key)) {
      seen.add(e.key);
      order.push(e.key);
    }
  }

  const entries: CatalogEntry[] = order.map((key) => {
    const src = srcByKey.get(key);
    const act = actByKey.get(key);
    const cells: Record<string, CatalogCell | undefined> = {};
    if (effectiveSource) {
      cells[effectiveSource] = src ? { value: src.value } : undefined;
    }
    cells[activeLang] = act
      ? {
          value: act.value,
          // Synthesize a state so allLanguageProgress + the "Untranslated"
          // filter (which key off state === "translated") work unchanged.
          state: act.value.trim() !== "" ? "translated" : undefined,
        }
      : undefined;
    return {
      key,
      comment: src?.comment ?? act?.comment,
      shouldTranslate: true,
      hasSubstitutions: false,
      rows: [{ variantKey: "", variantLabel: "", segments: [], cells }],
    };
  });

  const languages = effectiveSource ? [effectiveSource, activeLang] : [activeLang];
  return { sourceLanguage: effectiveSource, version: "", languages, entries };
}
