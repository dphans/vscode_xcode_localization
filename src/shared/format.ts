// Validate format specifiers between the source and the translation.
//
// iOS/printf: %@ %d %lld %1$@ %.2f %% … A translation must carry the same set
// of specifiers as the source, otherwise the app formats wrong / crashes. This
// is a warning (it does not block saving).
//
// Comparison strategy: compare the MULTISET of normalized "signatures"
// (position + length modifier + conversion char), IGNORING flags/width/
// precision and allowing reordering. Why: translations often reorder the
// sentence (that's exactly why iOS has %1$@); we only want to catch real
// mistakes (missing/extra/wrong-typed arguments), not false positives.

// %[pos$][flags][width][.precision][length]conv
// Note: space is NOT included in the flag class. Space is a valid printf flag
// (`% d`) but very rare in iOS, and accepting it would make "100% off" match
// as `% o` (octal) → false warnings when a literal "% word" differs between
// languages.
const SPEC_RE =
  /%(?:(\d+)\$)?([-+0#]*)(\d+|\*)?(\.(?:\d+|\*))?(hh|h|ll|l|q|L|z|t|j)?([@diouxXeEfgGaAcsp%])/g;

/**
 * Extract the list of (normalized) specifier signatures, dropping `%%`
 * (literal). E.g. "Done %1$@ in %.2f s" → ["1$@", "f"].
 */
export function extractSpecifiers(value: string): string[] {
  const out: string[] = [];
  SPEC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_RE.exec(value)) !== null) {
    const pos = m[1];
    const length = m[5];
    const conv = m[6];
    if (conv === "%") continue; // %% is a literal percent, not an argument

    let sig = "";
    if (pos) sig += pos + "$";
    if (length) sig += length;
    sig += conv;
    out.push(sig);
  }
  return out;
}

export interface FormatToken {
  text: string;
  /** True if this token is a real specifier (not `%%` or plain text). */
  isSpec: boolean;
}

/**
 * Split a value into plain-text and specifier tokens, for highlighting.
 * `%%` is treated as plain text (it is a literal percent, not an argument).
 */
export function tokenizeFormat(value: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  const re = new RegExp(SPEC_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const start = m.index;
    if (last < start) tokens.push({ text: value.slice(last, start), isSpec: false });
    tokens.push({ text: m[0], isSpec: m[6] !== "%" });
    last = start + m[0].length;
  }
  if (last < value.length) tokens.push({ text: value.slice(last), isSpec: false });
  return tokens;
}

export interface SpecifierDiff {
  ok: boolean;
  /** Specifiers present in the source but missing from the translation. */
  missing: string[];
  /** Specifiers present in the translation but not in the source. */
  extra: string[];
  sourceSpecs: string[];
  targetSpecs: string[];
}

/** a \ b as a multiset (keeps duplicates). */
function multisetDiff(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}

/**
 * Compare format specifiers between source and translation. `ok=true` if the
 * specifier sets match. An empty translation is NOT treated as a format error
 * (that is the "untranslated" state).
 */
export function diffSpecifiers(source: string, target: string): SpecifierDiff {
  const sourceSpecs = extractSpecifiers(source);
  const targetSpecs = extractSpecifiers(target);
  const missing = multisetDiff(sourceSpecs, targetSpecs);
  const extra = multisetDiff(targetSpecs, sourceSpecs);
  return {
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    sourceSpecs,
    targetSpecs,
  };
}
