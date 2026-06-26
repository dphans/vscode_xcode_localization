// Surgical editing for legacy `.strings` files.
//
// Same principle as edit.ts (.xcstrings): never re-serialize the whole file —
// replace only the exact span of the value literal, or append one new line.
// Every other byte stays put ⇒ minimal git diff. Reuses the host's TextReplace
// pipeline (XcstringsEditorProvider.applyEdits turns these into a WorkspaceEdit).

import type { TextReplace, EditResult, EditContext } from "../shared/edit";
import { parseStrings, escapeStringsValue } from "../shared/strings";

/**
 * Set the value for `key` in a `.strings` file.
 * - key found            → replace its value literal in place (one-token diff).
 * - key missing, value "" → no-op (don't write an empty translation).
 * - key missing, value    → append `"key" = "value";` at EOF, preserving the
 *                           trailing newline.
 * Duplicate keys (legal but pathological; Cocoa keeps the last) → edit the LAST.
 */
export function setStringValue(
  text: string,
  key: string,
  value: string,
  ctx: EditContext
): EditResult {
  const file = parseStrings(text);

  // Last occurrence wins (matches Cocoa's runtime behaviour + the model builder).
  let target = -1;
  for (let k = file.entries.length - 1; k >= 0; k--) {
    if (file.entries[k].key === key) {
      target = k;
      break;
    }
  }

  if (target >= 0) {
    const e = file.entries[target];
    const edit: TextReplace = {
      offset: e.valueStart,
      length: e.valueLength,
      newText: escapeStringsValue(value),
    };
    return { edits: [edit] };
  }

  // Key not present.
  if (value.trim() === "") return { edits: [] };

  const line = `${escapeStringsValue(key)} = ${escapeStringsValue(value)};`;
  const eol = ctx.eol;
  // Keep a single trailing newline: if the file already ends with one, the new
  // line goes after it; otherwise prepend an EOL to separate from the last line.
  const newText = file.endsWithNewline
    ? `${line}${eol}`
    : `${eol}${line}${eol}`;

  return { edits: [{ offset: text.length, length: 0, newText }] };
}

/**
 * Set / clear the `/* comment *​/` for `key` in a `.strings` file.
 * - empty comment + existing comment → remove the block (and its line).
 * - non-empty + existing comment     → replace the block in place.
 * - non-empty + no comment           → insert `/* comment *​/` above the key.
 * - key missing                      → no-op (a comment belongs to a key).
 * Duplicate keys → edit the LAST (matches setStringValue + the model builder).
 */
export function setStringComment(
  text: string,
  key: string,
  comment: string,
  ctx: EditContext
): EditResult {
  const file = parseStrings(text);

  let target = -1;
  for (let k = file.entries.length - 1; k >= 0; k--) {
    if (file.entries[k].key === key) {
      target = k;
      break;
    }
  }
  if (target < 0) return { edits: [] };

  const e = file.entries[target];
  const trimmed = comment.trim();
  const hasComment = e.commentStart !== undefined && e.commentLength !== undefined;

  if (trimmed === "") {
    if (!hasComment) return { edits: [] };
    // Remove the block AND the whitespace up to the key → no orphaned blank line.
    return {
      edits: [
        { offset: e.commentStart!, length: e.keyStart - e.commentStart!, newText: "" },
      ],
    };
  }

  const block = formatStringsComment(trimmed, ctx.eol);
  if (hasComment) {
    return {
      edits: [{ offset: e.commentStart!, length: e.commentLength!, newText: block }],
    };
  }
  // No comment yet → insert one on its own line directly above the key.
  return {
    edits: [{ offset: e.keyStart, length: 0, newText: `${block}${ctx.eol}` }],
  };
}

/** Wrap plain text as a `.strings` block comment, neutralising any `*​/` that
 * would close it early and normalising newlines to the file EOL. */
function formatStringsComment(comment: string, eol: string): string {
  const safe = comment.replace(/\*\//g, "* /").replace(/\r\n|\n/g, eol);
  return `/* ${safe} */`;
}
