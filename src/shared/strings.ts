// Model + parser for legacy `.strings` files (one file per language).
//
// Format: `"key" = "value";` lines, optional `/* comment */` blocks above a key,
// `//` line comments. Unlike .xcstrings there is no state / plural / variant /
// shouldTranslate metadata — the language is the enclosing `<lang>.lproj` dir.
//
// Like the .xcstrings parser this NEVER throws: on malformed input it records an
// `error`, resyncs, and returns whatever parsed. Each entry carries the offset
// span of its VALUE literal (including the surrounding quotes) so the surgical
// editor (editStrings.ts) can replace exactly that token and leave every other
// byte untouched ⇒ minimal git diff.

/** One parsed `"key" = "value";` pair, with the value's source span. */
export interface StringsEntry {
  /** Unescaped key. */
  key: string;
  /** Unescaped value. */
  value: string;
  /** Unescaped text of the immediately-preceding `/* *​/` comment, if adjacent. */
  comment?: string;
  /** Offset of the value literal's opening quote (UTF-16 code units). */
  valueStart: number;
  /** Length of the value literal INCLUDING both quotes — replace this span. */
  valueLength: number;
  /** Offset where the entry starts (the key token's first char) — the insertion
   * point for a brand-new comment line. */
  keyStart: number;
  /** Offset of the attached `/* *​/` block (the `/`), if a comment is present. */
  commentStart?: number;
  /** Length of that comment block INCLUDING the `/* *​/` delimiters. */
  commentLength?: number;
}

export interface StringsFile {
  entries: StringsEntry[];
  /** EOL detected from the file (defaults to "\n"). */
  eol: "\n" | "\r\n";
  /** Whether the file ends with a newline (so inserts keep the trailing EOL). */
  endsWithNewline: boolean;
  /** Set if a hard parse error occurred (entries holds what parsed so far). */
  error?: string;
}

/** Decode a `.strings` quoted literal (text INCLUDING the surrounding quotes). */
export function unescapeStringsLiteral(raw: string): string {
  let s = raw;
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1);
  }
  let out = "";
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c !== "\\" || k + 1 >= s.length) {
      out += c;
      continue;
    }
    const d = s[k + 1];
    switch (d) {
      case "n": out += "\n"; k++; break;
      case "t": out += "\t"; k++; break;
      case "r": out += "\r"; k++; break;
      case '"': out += '"'; k++; break;
      case "\\": out += "\\"; k++; break;
      case "u":
      case "U": {
        const hex = s.slice(k + 2, k + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          k += 5;
        } else {
          out += d; // lenient: keep the char after the backslash
          k++;
        }
        break;
      }
      default:
        out += d; // Cocoa is lenient: `\x` → `x`
        k++;
    }
  }
  return out;
}

/** Encode a string as a `.strings` quoted literal. Escapes the control chars and
 * quotes/backslash; non-ASCII is left RAW (Xcode writes UTF-8 verbatim). */
export function escapeStringsValue(value: string): string {
  let out = '"';
  for (const ch of value) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case "\\": out += "\\\\"; break;
      case "\n": out += "\\n"; break;
      case "\t": out += "\\t"; break;
      case "\r": out += "\\r"; break;
      default: out += ch;
    }
  }
  return out + '"';
}

function detectEol(text: string): "\n" | "\r\n" {
  const nl = text.indexOf("\n");
  return nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n";
}

/** Parse `.strings` text into ordered entries. */
export function parseStrings(text: string): StringsFile {
  const n = text.length;
  const eol = detectEol(text);
  const endsWithNewline = n === 0 || text[n - 1] === "\n";
  const entries: StringsEntry[] = [];
  let error: string | undefined;

  let i = 0;
  // The most recent `/* */` block and where it ended — attached to the next key
  // only when adjacent (no blank line between), so a file header isn't mistaken
  // for the first key's comment.
  let pendingComment: string | undefined;
  let pendingCommentStart = -1;
  let pendingCommentEnd = -1;

  /** Skip spaces/tabs/newlines and `//` line comments (NOT block comments). */
  const skipWsLine = () => {
    while (i < n) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        i++;
        continue;
      }
      if (c === "/" && text[i + 1] === "/") {
        const nl = text.indexOf("\n", i + 2);
        i = nl === -1 ? n : nl;
        continue;
      }
      break;
    }
  };

  /** Skip trivia, capturing the last block comment seen. */
  const skipTrivia = () => {
    for (;;) {
      const before = i;
      skipWsLine();
      if (i < n && text[i] === "/" && text[i + 1] === "*") {
        const blockStart = i;
        const inner = i + 2;
        const close = text.indexOf("*/", inner);
        const end = close === -1 ? n : close + 2;
        pendingComment = text.slice(inner, close === -1 ? n : close).trim();
        pendingCommentStart = blockStart;
        pendingCommentEnd = end;
        i = end;
      }
      if (i === before) break;
    }
  };

  /** Read a `"..."` literal; returns its full span (incl. quotes) or null. */
  const readQuotedSpan = (): { start: number; length: number } | null => {
    if (text[i] !== '"') return null;
    const start = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        i += 2; // skip the escaped char
        continue;
      }
      if (c === '"') {
        i++;
        return { start, length: i - start };
      }
      i++;
    }
    return { start, length: i - start }; // unterminated → to EOF
  };

  /** Read a bare (unquoted) key token, or null. */
  const readUnquotedKey = (): { start: number; length: number } | null => {
    const start = i;
    while (i < n) {
      const c = text[i];
      if (
        c === " " || c === "\t" || c === "\r" || c === "\n" ||
        c === "=" || c === ";" || c === '"' || c === "/"
      ) {
        break;
      }
      i++;
    }
    return i > start ? { start, length: i - start } : null;
  };

  /** On a malformed entry, jump past the next `;` or newline and carry on. */
  const resync = () => {
    if (!error) error = "Malformed .strings entry";
    while (i < n && text[i] !== ";" && text[i] !== "\n") i++;
    if (i < n) i++;
    pendingComment = undefined;
    pendingCommentStart = -1;
    pendingCommentEnd = -1;
  };

  while (i < n) {
    skipTrivia();
    if (i >= n) break;

    const keyStart = i;
    const keyQuoted = readQuotedSpan();
    const keySpan = keyQuoted ?? readUnquotedKey();
    if (!keySpan) {
      resync();
      continue;
    }
    const key = keyQuoted
      ? unescapeStringsLiteral(text.slice(keySpan.start, keySpan.start + keySpan.length))
      : text.slice(keySpan.start, keySpan.start + keySpan.length);

    // Comment attaches only if it sits directly above the key (no blank line).
    let comment: string | undefined;
    let commentStart: number | undefined;
    let commentLength: number | undefined;
    if (pendingComment !== undefined && pendingCommentEnd >= 0) {
      const gap = text.slice(pendingCommentEnd, keyStart);
      if ((gap.match(/\n/g)?.length ?? 0) < 2) {
        comment = pendingComment;
        commentStart = pendingCommentStart;
        commentLength = pendingCommentEnd - pendingCommentStart;
      }
    }
    pendingComment = undefined;
    pendingCommentStart = -1;
    pendingCommentEnd = -1;

    skipWsLine();

    // `"key";` shorthand → value equals the key (its own span).
    if (text[i] === ";") {
      i++;
      entries.push({
        key,
        value: key,
        comment,
        valueStart: keySpan.start,
        valueLength: keySpan.length,
        keyStart,
        commentStart,
        commentLength,
      });
      continue;
    }

    if (text[i] !== "=") {
      resync();
      continue;
    }
    i++; // consume '='
    skipWsLine();

    const valQuoted = readQuotedSpan();
    const valSpan = valQuoted ?? readUnquotedKey();
    if (!valSpan) {
      resync();
      continue;
    }
    const value = valQuoted
      ? unescapeStringsLiteral(text.slice(valSpan.start, valSpan.start + valSpan.length))
      : text.slice(valSpan.start, valSpan.start + valSpan.length);

    skipWsLine();
    if (text[i] === ";") i++; // optional terminator

    entries.push({
      key,
      value,
      comment,
      valueStart: valSpan.start,
      valueLength: valSpan.length,
      keyStart,
      commentStart,
      commentLength,
    });
  }

  return { entries, eol, endsWithNewline, error };
}

/**
 * Translation progress of one language's entries against the source key set:
 * a key counts as translated when it exists in the source and has a non-empty
 * value. (Used by the activity-bar tree.)
 */
export function stringsProgress(
  sourceKeys: Set<string>,
  entries: StringsEntry[]
): { translated: number; total: number; percent: number } {
  const total = sourceKeys.size;
  let translated = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.key)) continue; // duplicate keys: count once
    seen.add(e.key);
    if (sourceKeys.has(e.key) && e.value.trim() !== "") translated++;
  }
  return {
    translated,
    total,
    percent: total === 0 ? 0 : Math.round((translated / total) * 100),
  };
}
