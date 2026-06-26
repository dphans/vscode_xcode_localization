// Surgical editing engine for .xcstrings.
//
// Core principle (see the architecture-decisions memory): do NOT re-serialize
// the whole file. Reason: Xcode's `strings` key order uses a comparator that
// matches no standard sort — re-sorting would dirty the diff or shuffle keys.
// Instead we only:
//   - replace the exact span of an existing "value"/"state", or
//   - insert a "<lang>" : { stringUnit … } block at the correct position
//     (language codes sort by code unit — verified to match Xcode 100% on the
//     real file).
// Every other byte stays untouched ⇒ minimal git diff.
//
// The output must match Xcode (Foundation, measured on the real file):
//   - colon as " : " (space on both sides)
//   - 2-space indent, EOL from the document (CRLF/LF)
//   - slash '/' written raw (no \/), non-ASCII written raw → JSON.stringify
//     already matches all three.

import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";

/** A single offset-based replacement (the host turns it into a vscode.Range). */
export interface TextReplace {
  offset: number;
  length: number;
  newText: string;
}

export interface EditContext {
  /** "\r\n" or "\n", taken from document.eol. */
  eol: string;
  /** Indent unit, defaults to 2 spaces (xcstrings always uses 2 spaces). */
  indentUnit?: string;
}

export interface EditResult {
  edits: TextReplace[];
  /** Reason if no edit could be produced (the cell stays unchanged). */
  reason?: string;
}

/**
 * Stringify the way Xcode writes values: raw slashes, raw non-ASCII, standard
 * JSON control-char escapes. JSON.stringify already does all three (it does not
 * escape '/' nor non-ASCII).
 */
function jsonString(s: string): string {
  return JSON.stringify(s);
}

/** Leading whitespace of the line containing `offset` (handles CRLF and LF). */
function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  let i = lineStart;
  let ws = "";
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    ws += text[i];
    i++;
  }
  return ws;
}

/**
 * Set the translation for (key, lang) at a SINGLE stringUnit (no variations).
 * - empty value + existing slot → keep the slot, value "", state "new".
 * - empty value + missing slot  → do nothing (don't insert an empty translation).
 * - non-empty value → state "translated".
 */
export function setTranslation(
  text: string,
  key: string,
  lang: string,
  segments: string[],
  value: string,
  ctx: EditContext
): EditResult {
  const root = parseTree(text);
  if (!root) return { edits: [], reason: "JSON could not be parsed" };

  const indentUnit = ctx.indentUnit ?? "  ";
  const isEmpty = value.trim() === "";
  const newState = isEmpty ? "new" : "translated";

  // `segments` is the relative jsonc path to the variation node (e.g.
  // ["variations","plural","one"] or ["substitutions","count","variations",
  // "plural","one"]); [] is the base stringUnit.
  const base = [
    "strings",
    key,
    "localizations",
    lang,
    ...segments,
    "stringUnit",
  ];

  const unitNode = findNodeAtLocation(root, base);
  if (unitNode) {
    return replaceExisting(text, root, base, value, newState, ctx);
  }

  if (isEmpty) return { edits: [] };

  const locNode = findNodeAtLocation(root, ["strings", key, "localizations"]);
  if (!locNode || locNode.type !== "object") {
    return {
      edits: [],
      reason: "key has no 'localizations' yet — creating one is not supported yet",
    };
  }

  // Simple cell → the verified single-stringUnit insert. Variant cell → build
  // the smallest missing subtree along the variations path.
  if (segments.length === 0) {
    return {
      edits: [insertLanguage(text, locNode, lang, value, ctx, indentUnit)],
    };
  }
  return insertCell(text, locNode, lang, segments, value, ctx, indentUnit);
}

function replaceExisting(
  text: string,
  root: Node,
  base: string[],
  value: string,
  newState: string,
  ctx: EditContext
): EditResult {
  const valueNode = findNodeAtLocation(root, [...base, "value"]);
  const stateNode = findNodeAtLocation(root, [...base, "state"]);

  const edits: TextReplace[] = [];

  if (valueNode) {
    edits.push({
      offset: valueNode.offset,
      length: valueNode.length,
      newText: jsonString(value),
    });
  } else if (stateNode) {
    // stringUnit has a state but no value → insert "value" after "state".
    const indent = lineIndentAt(text, stateNode.offset);
    const at = stateNode.offset + stateNode.length;
    edits.push({
      offset: at,
      length: 0,
      newText: `,${ctx.eol}${indent}"value" : ${jsonString(value)}`,
    });
  } else {
    return { edits: [], reason: "stringUnit has neither state nor value" };
  }

  if (stateNode) {
    edits.push({
      offset: stateNode.offset,
      length: stateNode.length,
      newText: jsonString(newState),
    });
  }

  return { edits };
}

/**
 * Insert a new language block into the localizations object at the correct
 * code-unit position.
 */
function insertLanguage(
  text: string,
  locNode: Node,
  lang: string,
  value: string,
  ctx: EditContext,
  indentUnit: string
): TextReplace {
  const eol = ctx.eol;
  const parentIndent = lineIndentAt(text, locNode.offset); // the `"localizations" : {` line
  const baseIndent = parentIndent + indentUnit; // where `"<lang>"` goes

  const block = renderLangBlock(lang, value, baseIndent, eol, indentUnit);

  const props = (locNode.children ?? []).filter((c) => c.type === "property");
  const entries = props.map((p) => ({
    name: String(p.children![0].value),
    node: p,
  }));

  // Empty object: `"localizations" : {}`
  if (entries.length === 0) {
    return {
      offset: locNode.offset + 1, // right after '{'
      length: 0,
      newText: `${eol}${baseIndent}${block}${eol}${parentIndent}`,
    };
  }

  // Find the insert position by code-unit order of the language code.
  let insertBefore: Node | null = null;
  for (const e of entries) {
    if (lang < e.name) {
      insertBefore = e.node;
      break;
    }
  }

  if (insertBefore) {
    // Insert right before this property (the "baseIndent" already precedes it).
    return {
      offset: insertBefore.offset,
      length: 0,
      newText: `${block},${eol}${baseIndent}`,
    };
  }

  // Sorts after everything → insert after the last property (no trailing comma).
  const last = entries[entries.length - 1].node;
  return {
    offset: last.offset + last.length,
    length: 0,
    newText: `,${eol}${baseIndent}${block}`,
  };
}

/** Render `"<lang>" : { "stringUnit" : { "state"…, "value"… } }`. */
function renderLangBlock(
  lang: string,
  value: string,
  baseIndent: string,
  eol: string,
  indentUnit: string
): string {
  const i1 = baseIndent + indentUnit;
  const i2 = i1 + indentUnit;
  return (
    `${jsonString(lang)} : {` +
    eol +
    `${i1}"stringUnit" : {` +
    eol +
    `${i2}"state" : "translated",` +
    eol +
    `${i2}"value" : ${jsonString(value)}` +
    eol +
    `${i1}}` +
    eol +
    `${baseIndent}}`
  );
}

// ---- Variations (plural / device) & substitutions ----
//
// A variant/substitution cell lives at localizations/<lang>/<segments…>/
// stringUnit, where `segments` is the relative jsonc path: e.g.
// ["variations","plural","one"] or
// ["substitutions","count","variations","plural","one"]. We edit an existing
// stringUnit the same way as a simple one (replaceExisting), and create a
// missing one by inserting the SMALLEST missing subtree at code-unit order —
// the same ordering rule verified for language codes (plural cases / device
// names are ASCII, so code-unit == Xcode's sorted keys).

/**
 * Render the JSON value text for a single nested path ending in a stringUnit.
 * `chain` is the property names from the inserted node down to "stringUnit";
 * `indent` is the indentation of the property this value is attached to.
 */
function renderChainValue(
  chain: string[],
  value: string,
  indent: string,
  eol: string,
  indentUnit: string
): string {
  const i1 = indent + indentUnit;
  if (chain.length === 1) {
    // chain[0] === "stringUnit" → { "state" …, "value" … }
    return (
      `{${eol}${i1}"state" : "translated",` +
      `${eol}${i1}"value" : ${jsonString(value)}${eol}${indent}}`
    );
  }
  const childKey = chain[1];
  const childVal = renderChainValue(chain.slice(1), value, i1, eol, indentUnit);
  return `{${eol}${i1}${jsonString(childKey)} : ${childVal}${eol}${indent}}`;
}

/**
 * Create a variant cell for a target language. Walks from `localizations` down
 * the variant path, then inserts the smallest missing subtree. Declines (with a
 * reason, no edit) when a shape conflict would otherwise produce invalid JSON.
 */
function insertCell(
  text: string,
  locNode: Node,
  lang: string,
  segments: string[],
  value: string,
  ctx: EditContext,
  indentUnit: string
): EditResult {
  const chain = [lang, ...segments, "stringUnit"];

  let container = locNode;
  let i = 0;
  while (i < chain.length) {
    const prop = findProperty(container, chain[i]);
    if (!prop) break;
    const v = propValue(prop);
    if (v.type !== "object") {
      return {
        edits: [],
        reason: `cannot edit variant: '${chain[i]}' is not an object`,
      };
    }
    container = v;
    i++;
  }

  // stringUnit already present → the caller routes those to replaceExisting; a
  // concurrent edit could land here, so just do nothing.
  if (i === chain.length) return { edits: [] };

  // A localization is EITHER a stringUnit OR variations, never both.
  if (chain[i] === "variations" && findProperty(container, "stringUnit")) {
    return {
      edits: [],
      reason: "this language has a plain value for the key; cannot add variations",
    };
  }

  // Substitutions carry required metadata (formatSpecifier/argNum) we cannot
  // synthesize. Only FILL an existing one: allow inserting just the leaf case
  // (i === segments.length) or its stringUnit; decline if an ancestor above the
  // case (the substitution itself, its name, or its variations) is missing.
  if (segments.includes("substitutions") && i < segments.length) {
    return {
      edits: [],
      reason:
        "no such substitution in this language yet — add the language in Xcode first",
    };
  }

  const baseIndent = lineIndentAt(text, container.offset) + indentUnit;
  const valueText = renderChainValue(
    chain.slice(i),
    value,
    baseIndent,
    ctx.eol,
    indentUnit
  );
  return {
    edits: [insertProperty(text, container, chain[i], valueText, ctx, indentUnit)],
  };
}

// ---- String-level config: comment, shouldTranslate, per-cell state ----
//
// These edit object properties rather than translation values. Xcode writes
// every object's keys in code-unit (alphabetical) order, so within a string
// entry the order is: comment < extractionState < localizations <
// shouldTranslate, and within a stringUnit: state < value. We insert each new
// property at its correct slot so the diff stays clean and Xcode won't reshuffle
// it on the next save.

/** Find a direct property node by name in an object node, or null. */
function findProperty(objNode: Node, name: string): Node | null {
  for (const c of objNode.children ?? []) {
    if (
      c.type === "property" &&
      c.children &&
      String(c.children[0].value) === name
    ) {
      return c;
    }
  }
  return null;
}

/** The value node of a property (its `children[1]`). */
function propValue(prop: Node): Node {
  return prop.children![1];
}

/**
 * Insert `"name" : <valueText>` into `objNode` at code-unit order among the
 * existing keys. Mirrors {@link insertLanguage} but for arbitrary properties.
 */
function insertProperty(
  text: string,
  objNode: Node,
  name: string,
  valueText: string,
  ctx: EditContext,
  indentUnit: string
): TextReplace {
  const eol = ctx.eol;
  const parentIndent = lineIndentAt(text, objNode.offset); // the `… : {` line
  const baseIndent = parentIndent + indentUnit; // where the property goes
  const block = `${jsonString(name)} : ${valueText}`;

  const props = (objNode.children ?? []).filter((c) => c.type === "property");

  // Empty object: `{}` → `{ <prop> }`.
  if (props.length === 0) {
    return {
      offset: objNode.offset + 1, // right after '{'
      length: 0,
      newText: `${eol}${baseIndent}${block}${eol}${parentIndent}`,
    };
  }

  let insertBefore: Node | null = null;
  for (const p of props) {
    if (name < String(p.children![0].value)) {
      insertBefore = p;
      break;
    }
  }

  if (insertBefore) {
    return {
      offset: insertBefore.offset,
      length: 0,
      newText: `${block},${eol}${baseIndent}`,
    };
  }

  // Sorts after everything → append after the last property.
  const last = props[props.length - 1];
  return {
    offset: last.offset + last.length,
    length: 0,
    newText: `,${eol}${baseIndent}${block}`,
  };
}

/**
 * Remove the named property from `objNode`, fixing the surrounding comma so the
 * JSON stays valid. Returns null if the property isn't present.
 */
function removeProperty(
  text: string,
  objNode: Node,
  name: string
): TextReplace | null {
  const props = (objNode.children ?? []).filter((c) => c.type === "property");
  const idx = props.findIndex((p) => String(p.children![0].value) === name);
  if (idx === -1) return null;
  const prop = props[idx];

  // Only property → empty the object out to `{}`.
  if (props.length === 1) {
    const open = objNode.offset; // at '{'
    const close = objNode.offset + objNode.length - 1; // at '}'
    return { offset: open + 1, length: close - (open + 1), newText: "" };
  }

  // Not last → drop this property plus its trailing comma/indent (everything up
  // to where the next property starts).
  if (idx < props.length - 1) {
    const next = props[idx + 1];
    return { offset: prop.offset, length: next.offset - prop.offset, newText: "" };
  }

  // Last → drop the preceding comma + this property.
  const prev = props[idx - 1];
  const start = prev.offset + prev.length;
  const end = prop.offset + prop.length;
  return { offset: start, length: end - start, newText: "" };
}

function findKeyObject(root: Node, key: string): Node | null {
  const node = findNodeAtLocation(root, ["strings", key]);
  return node && node.type === "object" ? node : null;
}

/**
 * Set (or clear) the developer comment / note for a key. An empty/whitespace
 * comment removes the property entirely (Xcode drops empty comments).
 */
export function setComment(
  text: string,
  key: string,
  comment: string,
  ctx: EditContext
): EditResult {
  const root = parseTree(text);
  if (!root) return { edits: [], reason: "JSON could not be parsed" };
  const indentUnit = ctx.indentUnit ?? "  ";

  const keyNode = findKeyObject(root, key);
  if (!keyNode) return { edits: [], reason: `key not found: ${key}` };

  const existing = findProperty(keyNode, "comment");

  if (comment.trim() === "") {
    if (!existing) return { edits: [] };
    const rem = removeProperty(text, keyNode, "comment");
    return { edits: rem ? [rem] : [] };
  }

  if (existing) {
    const v = propValue(existing);
    return {
      edits: [{ offset: v.offset, length: v.length, newText: jsonString(comment) }],
    };
  }
  return {
    edits: [insertProperty(text, keyNode, "comment", jsonString(comment), ctx, indentUnit)],
  };
}

/**
 * Toggle whether a key should be translated. `true` is the default, so it is
 * expressed by REMOVING the property; `false` writes `"shouldTranslate" : false`.
 */
export function setShouldTranslate(
  text: string,
  key: string,
  value: boolean,
  ctx: EditContext
): EditResult {
  const root = parseTree(text);
  if (!root) return { edits: [], reason: "JSON could not be parsed" };
  const indentUnit = ctx.indentUnit ?? "  ";

  const keyNode = findKeyObject(root, key);
  if (!keyNode) return { edits: [], reason: `key not found: ${key}` };

  const existing = findProperty(keyNode, "shouldTranslate");

  if (value) {
    // Default → represented by absence.
    if (!existing) return { edits: [] };
    const rem = removeProperty(text, keyNode, "shouldTranslate");
    return { edits: rem ? [rem] : [] };
  }

  if (existing) {
    const v = propValue(existing);
    return { edits: [{ offset: v.offset, length: v.length, newText: "false" }] };
  }
  return {
    edits: [insertProperty(text, keyNode, "shouldTranslate", "false", ctx, indentUnit)],
  };
}

/** Build the jsonc location path to a cell's stringUnit. `segments` is the
 * relative path to the variation node (variations and/or substitutions). */
function unitPath(key: string, lang: string, segments: string[]): string[] {
  return ["strings", key, "localizations", lang, ...segments, "stringUnit"];
}

/**
 * Set the review state of a single cell (no value change). `segments` is the
 * variant path ([] for a plain stringUnit). The stringUnit must already exist
 * (you can't mark an absent translation).
 */
export function setState(
  text: string,
  key: string,
  lang: string,
  segments: string[],
  state: string,
  ctx: EditContext
): EditResult {
  const root = parseTree(text);
  if (!root) return { edits: [], reason: "JSON could not be parsed" };
  const indentUnit = ctx.indentUnit ?? "  ";

  const base = unitPath(key, lang, segments);
  const unitNode = findNodeAtLocation(root, base);
  if (!unitNode || unitNode.type !== "object") {
    return { edits: [], reason: "no stringUnit for this cell" };
  }

  const stateNode = findNodeAtLocation(root, [...base, "state"]);
  if (stateNode) {
    return {
      edits: [{ offset: stateNode.offset, length: stateNode.length, newText: jsonString(state) }],
    };
  }
  // No state yet → insert before "value" (state < value).
  return {
    edits: [insertProperty(text, unitNode, "state", jsonString(state), ctx, indentUnit)],
  };
}

/** Apply TextReplaces to a string (handy for tests / host fallback). */
export function applyReplaces(text: string, edits: TextReplace[]): string {
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.offset) + e.newText + out.slice(e.offset + e.length);
  }
  return out;
}
