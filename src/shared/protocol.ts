// Shared message types between the extension host and the webview.

import type { Catalog } from "./xcstrings";

/** User-configurable display options, mirrored from the `xcodeI18n.*` settings.
 * The settings are the single source of truth; the webview's toolbar toggles
 * just write back to them (see `setSettings`). */
export interface Settings {
  /** Row density. */
  displayMode: "comfortable" | "compact";
  /** Fold the Key + source into one column (true) or keep them separate. */
  mergeKeySource: boolean;
  /** Require a double-click to edit a cell (true) vs editing on a single click. */
  doubleClickToEdit: boolean;
}

/** Per-format feature gates. `.xcstrings` has them all; `.strings` lacks state /
 * shouldTranslate / (for now) comment editing and the git diff baseline. */
export interface Capabilities {
  /** Per-cell review state ("Mark as Reviewed/Needs Review"). */
  reviewState: boolean;
  /** Per-key "Don't translate" toggle. */
  shouldTranslate: boolean;
  /** Editing the developer note/comment inline. */
  editComment: boolean;
  /** The git-HEAD "Changed" diff column/tab. */
  diff: boolean;
  /** Whether the user can pick which target-language columns are shown (the
   * language chip in the search bar). True for .xcstrings (many languages in one
   * file); false for .strings, where the file IS a single fixed language. */
  chooseColumns: boolean;
  /** Whether keys can be "orphaned" — present in a target file but absent from
   * the source language (a `.strings` concern: each language is a separate file
   * so keys drift). True for .strings; false for .xcstrings (one file, one key
   * set, so a key can never be orphaned). Gates the "Orphaned" filter + badge. */
  orphanKeys: boolean;
  /** Whether the KEY doubles as the implicit source string for format-specifier
   * validation (true for .xcstrings, where the key is the dev-language string;
   * false for .strings, where the key is an identifier — only a real source
   * language value is compared, never the key). */
  keyAsSource: boolean;
}

/** Host → Webview */
export type HostToWebview =
  | { type: "init"; text: string }
  | { type: "update"; text: string }
  /** A prebuilt catalog (used for `.strings`, which the host parses + aggregates
   * from sibling-language files rather than the webview parsing one text). */
  | { type: "model"; catalog: Catalog }
  /** File content at git HEAD (baseline for the "changed since commit" markers).
   * null when the file isn't tracked / there's no repo. Re-sent when HEAD moves.
   * Used for `.xcstrings` (the webview parses the JSON itself). */
  | { type: "baseline"; text: string | null }
  /** Prebuilt baseline catalog at git HEAD — the `.strings` counterpart of
   * `baseline`. The host parses HEAD with its `.strings` parser (the webview's
   * JSON parser can't), so it ships a ready Catalog. null = untracked / no repo. */
  | { type: "baselineModel"; catalog: Catalog | null }
  /** Current settings — sent once on ready and again whenever the config changes. */
  | { type: "settings"; settings: Settings }
  /** Feature gates for the current file's format — sent once on ready. */
  | { type: "capabilities"; capabilities: Capabilities }
  /** The file changed on disk while the document had unsaved edits (e.g. an
   * external agent rewrote it). VSCode won't auto-reload a dirty document, so the
   * webview surfaces a conflict banner: saving now would clobber the disk copy. */
  | { type: "externalChange" }
  /** Restored per-file layout, sent on ready. The host owns this now (persisted
   * in `workspaceState`, not in the project tree). `targets`/`widths` are this
   * file's saved choice (null targets = never chosen); `lastTargets` is the most
   * recent explicit column set in the workspace, so a brand-new file inherits it
   * instead of defaulting to the first language. */
  | {
      type: "layout";
      targets: string[] | null;
      widths: Record<string, number>;
      lastTargets: string[] | null;
    }
  /** Focus a single target language: show only Key/source + that column. Sent
   * when a language is picked from the sidebar tree (works for an already-open
   * editor too). Sent after `layout` so it wins over the restored columns. */
  | { type: "selectLanguage"; lang: string }
  /** Result of a `scanUsage` request: `counts[key]` = number of quoted-literal
   * references found in code (0 = none → likely unused). `filesScanned` is how
   * many source files were read (0 → the workspace had none to compare against,
   * so the webview shouldn't flag anything as unused). */
  | {
      type: "usage";
      counts: Record<string, number>;
      filesScanned: number;
    };

/** Webview → Host */
export type WebviewToHost =
  | { type: "ready" }
  /** Reopen this file in the plain text editor (escape hatch to fix broken JSON). */
  | { type: "openAsText" }
  /** Find a key's usages in source code. The host opens VSCode's built-in search
   * panel scoped to Swift / Obj-C files, pre-filled with the key as a quoted
   * string literal — so it lands on the `Text("…")` / `NSLocalizedString("…", …)`
   * call site a developer would refactor, not every loose word. The host never
   * reads code itself; it just drives `workbench.action.findInFiles`. */
  | { type: "findInCode"; key: string }
  /** Run an on-demand scan of the workspace's Swift / Obj-C source for how many
   * times each key appears as a quoted string literal. Used to flag keys with no
   * code reference (likely-dead translations) without any always-on indexing —
   * the host reads source files once per request and replies with `usage`. */
  | { type: "scanUsage"; keys: string[] }
  /**
   * Set the translation for a cell. `segments` is the variant path ([] for a
   * plain stringUnit; e.g. ["plural","other"] for a plural form). The host
   * computes the surgical edit and applies a WorkspaceEdit to the TextDocument.
   */
  | {
      type: "setValue";
      key: string;
      lang: string;
      segments: string[];
      value: string;
    }
  /** Set/clear the developer note (comment) for a key. Empty → remove. */
  | { type: "setComment"; key: string; comment: string }
  /** Toggle whether a key should be translated (false → "Don't Translate"). */
  | { type: "setShouldTranslate"; key: string; value: boolean }
  /**
   * Set the review state of a single cell (no value change). `segments` is the
   * variant path ([] for a plain stringUnit).
   */
  | {
      type: "setState";
      key: string;
      lang: string;
      segments: string[];
      state: string;
    }
  /** Persist a display option to the user settings (toolbar toggle → config). */
  | { type: "setSettings"; settings: Partial<Settings> }
  /** Discard unsaved in-memory edits and reload the document from disk — the
   * response to an `externalChange` banner's "Reload from disk" action. */
  | { type: "reload" }
  /** Persist this file's layout (chosen target columns + dragged widths) to the
   * host's `workspaceState`. `targets: null` means "never explicitly chosen". */
  | {
      type: "setLayout";
      targets: string[] | null;
      widths: Record<string, number>;
    };
