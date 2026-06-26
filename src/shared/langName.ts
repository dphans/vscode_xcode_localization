// Human-readable language names from BCP 47 codes via the built-in
// Intl.DisplayNames — no dependency, no hardcoded table. Names are shown in
// English to match the UI; the code is always kept nearby (the catalog files
// and developers work in codes). Falls back to the code if unknown/unsupported.
//
// Lives in shared/ (no DOM use) so both the webview grid and the host-side
// localization tree can use it.

const cache = new Map<string, string>();

let displayNames: Intl.DisplayNames | undefined;
try {
  // languageDisplay:"standard" → "Chinese (Simplified)" / "Portuguese (Brazil)"
  // (the alternative "dialect" gives "Simplified Chinese" / "Brazilian
  // Portuguese"). Unknown options are ignored by older engines, so this is safe.
  displayNames = new Intl.DisplayNames(["en"], {
    type: "language",
    languageDisplay: "standard",
  });
} catch {
  displayNames = undefined;
}

/** e.g. "zh-Hans" → "Chinese (Simplified)", "pt-BR" → "Portuguese (Brazil)". */
export function langName(code: string): string {
  const hit = cache.get(code);
  if (hit !== undefined) return hit;
  let name = code;
  if (displayNames) {
    try {
      name = displayNames.of(code) ?? code;
    } catch {
      name = code;
    }
  }
  cache.set(code, name);
  return name;
}
