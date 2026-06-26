import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ReactNode,
  KeyboardEvent as ReactKeyboardEvent,
  FocusEvent as ReactFocusEvent,
} from "react";
import type {
  CatalogCell,
  CatalogEntry,
  CatalogRow,
} from "../src/shared/xcstrings";
import { stateLabel } from "../src/shared/xcstrings";
import { diffSpecifiers, tokenizeFormat } from "../src/shared/format";
import { findRanges } from "../src/shared/search";
import type { LangProgress } from "../src/shared/progress";
import { useRowVirtualizer } from "./virtualizer";
import { WarningIcon, KebabIcon, SearchIcon } from "./icons";
import { Menu, MenuItem, MenuSeparator, type MenuPos } from "./Menu";
import { baselineCell, cellChange, type Baseline } from "./diff";
import { langName } from "../src/shared/langName";
import type { Capabilities } from "../src/shared/protocol";

/** Viewport coords from a mouse event (cursor for right-click). */
function posFromCursor(e: { clientX: number; clientY: number }): MenuPos {
  return { x: e.clientX, y: e.clientY };
}

/** Viewport coords just below the left edge of a button (kebab anchor). */
function posBelow(el: HTMLElement): MenuPos {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

/** Assumed height of an unmeasured row (only affects off-screen estimates). */
const ROW_ESTIMATE = 46;

// ---- Resizable columns ----
// Every column except the LAST has an explicit pixel width (drag the header's
// right edge to resize, double-click to reset). The last column flexes
// (`minmax(width, 1fr)`) so the rows always fill the pane — no blank gutter —
// while its dragged width becomes the min once the columns overflow into a
// horizontal scroll. Widths are stored per column id: the key column under
// KEY_COL_ID, every language column under its code.
const KEY_COL_ID = "$key";
const DEFAULT_KEY_WIDTH = 260;
// Merged view's first column holds the source string (prose), so it defaults a
// touch wider than the plain Key column. Same stored id (KEY_COL_ID) — a drag
// carries across both views.
const DEFAULT_REF_WIDTH = 340;
const DEFAULT_COL_WIDTH = 300;
const MIN_KEY_WIDTH = 140;
const MIN_COL_WIDTH = 120;

/**
 * The grab strip on a header cell's right edge. Drag to resize the column live;
 * double-click to reset it to the default width. Uses pointer capture so the
 * drag keeps tracking even when the cursor leaves the thin strip.
 */
function ColResizer({
  colId,
  width,
  min,
  label,
  onResize,
  onReset,
  onCommit,
}: {
  colId: string;
  width: number;
  min: number;
  label: string;
  onResize(colId: string, px: number): void;
  onReset(colId: string): void;
  /** Called once the drag/reset settles → lets the grid re-measure row heights. */
  onCommit(): void;
}) {
  const startX = useRef(0);
  const startW = useRef(0);
  const dragging = useRef(false);
  return (
    <span
      className="col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging.current = true;
        startX.current = e.clientX;
        startW.current = width;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const next = Math.max(
          min,
          Math.round(startW.current + (e.clientX - startX.current))
        );
        onResize(colId, next);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
        onCommit();
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReset(colId);
        onCommit();
      }}
    />
  );
}

/** Active search query, shared with deep cells so they can highlight matches. */
const QueryContext = createContext("");

/** Wrap occurrences of the query in <mark> for highlighting. */
function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = query ? findRanges(text, query) : [];
  if (ranges.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([s, e], i) => {
    if (last < s) out.push(text.slice(last, s));
    out.push(
      <mark key={i} className="hl">
        {text.slice(s, e)}
      </mark>
    );
    last = e;
  });
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * Render a value with format specifiers (%@, %lld, %1$@…) highlighted, and the
 * active search query highlighted within the plain-text segments.
 */
function FormatValue({ value }: { value: string }) {
  const query = useContext(QueryContext);
  return (
    <>
      {tokenizeFormat(value).map((t, i) =>
        t.isSpec ? (
          <span key={i} className="spec">
            {t.text}
          </span>
        ) : query ? (
          <Highlight key={i} text={t.text} query={query} />
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </>
  );
}

/** Format-specifier mismatch (null if matching / translation is empty). */
interface FormatWarn {
  missing: string[];
  extra: string[];
}

function computeWarn(
  sourceValue: string | undefined,
  value: string | undefined
): FormatWarn | null {
  // No source value to compare against (e.g. editing a .strings source file, or
  // a key absent from the source) → nothing to validate.
  if (sourceValue === undefined) return null;
  if (!value || value.trim() === "") return null;
  const d = diffSpecifiers(sourceValue, value);
  return d.ok ? null : { missing: d.missing, extra: d.extra };
}

/** "@" → "%@", "1$@" → "%1$@" for display. */
function showSpec(sig: string): string {
  return "%" + sig;
}

function warnText(warn: FormatWarn): string {
  const parts: string[] = [];
  if (warn.missing.length)
    parts.push("missing " + warn.missing.map(showSpec).join(", "));
  if (warn.extra.length)
    parts.push("extra " + warn.extra.map(showSpec).join(", "));
  return parts.join(" · ");
}

function FormatWarning({ warn }: { warn: FormatWarn }) {
  return (
    <div
      className="cell-warn"
      title={`Format specifiers don't match the source — ${warnText(warn)}`}
    >
      <WarningIcon size={12} />
      <span>{warnText(warn)}</span>
    </div>
  );
}

interface GridProps {
  /** Entries to render (already filtered by the caller). */
  entries: CatalogEntry[];
  sourceLanguage: string;
  /** Target languages currently shown (besides the source). */
  targets: string[];
  /** Per-language translation progress (rendered under each header). */
  progress: Record<string, LangProgress>;
  /** Active search query (highlighted in keys/values; rows already filtered). */
  query: string;
  /** Git HEAD baseline for "changed since commit" markers (null = no diff). */
  baseline: Baseline | null;
  /** Per-column widths the user has dragged (colId → px; absent = default). */
  widths: Record<string, number>;
  /** Row spacing (only used here to invalidate cached heights on change). */
  density: "comfortable" | "compact";
  /** Merged view: fold the source value into the frozen Key column (one frozen
   * column instead of Key + source). Split view keeps them separate. */
  merged: boolean;
  /** When true (default), a single click selects a cell and a double-click opens
   * the editor; when false, a single click opens the editor. */
  doubleClickToEdit: boolean;
  /** Per-format feature gates (review state / don't-translate / comment edit). */
  caps: Capabilities;
  /** Live column resize (while dragging). */
  onResize(colId: string, px: number): void;
  /** Reset a column to its default width (double-click). */
  onResetWidth(colId: string): void;
  /** Send a "set translation" request to the host. */
  onSetValue(key: string, lang: string, segments: string[], value: string): void;
  /** Set/clear the developer note (comment) for a key (empty → remove). */
  onSetComment(key: string, comment: string): void;
  /** Toggle whether a key should be translated. */
  onSetShouldTranslate(key: string, value: boolean): void;
  /** Set the review state of a single cell (no value change). */
  onSetState(key: string, lang: string, segments: string[], state: string): void;
  /** Find this key's usages in source code (opens VSCode's scoped search). */
  onFindInCode(key: string): void;
  /** Per-key count of code references from the last on-demand scan (null = not
   * scanned). A key whose count is exactly 0 is flagged "unused". */
  usage?: Record<string, number> | null;
}

interface EditingCell {
  key: string;
  lang: string;
  /** Variant path of the cell ("" for a plain stringUnit) — disambiguates the
   * multiple rows a plural/device key flattens into (same key+lang). */
  variantKey: string;
}

/** How an edit was committed → where the keyboard cursor goes next.
 * down = Enter, right = Tab, left = Shift+Tab, none = blur/Escape (stay). */
type Move = "down" | "right" | "left" | "none";

/** The single open menu (string actions on a key, or review state on a cell). */
type MenuState =
  | { kind: "string"; entry: CatalogEntry; pos: MenuPos }
  | {
      kind: "cell";
      entry: CatalogEntry;
      row: CatalogRow;
      lang: string;
      pos: MenuPos;
    };

/**
 * A single visual row. A simple key → one "single" row. A plural/device key →
 * one "header" row (the key name, empty value columns) followed by one
 * "variant" sub-row per form. Grouping a key's rows lets us draw the divider
 * only between keys and shade the whole group as one block.
 */
type RowKind = "single" | "header" | "variant";
interface FlatRow {
  entry: CatalogEntry;
  row: CatalogRow;
  kind: RowKind;
  /** Index of the owning entry (zebra shades per entry, not per row). */
  entryIndex: number;
  /** Last row of its key's group → carries the bottom divider. */
  lastInGroup: boolean;
  key: string;
}

/**
 * Grid table (M2): single-stringUnit target cells are editable (click to open a
 * textarea). The source column and variant (plural/device) cells stay
 * read-only. Rows are virtualized (M5): only the visible window is in the DOM.
 */
export function Grid({
  entries,
  sourceLanguage,
  targets,
  progress,
  query,
  baseline,
  widths,
  density,
  merged,
  doubleClickToEdit,
  caps,
  onResize,
  onResetWidth,
  onSetValue,
  onSetComment,
  onSetShouldTranslate,
  onSetState,
  onFindInCode,
  usage,
}: GridProps) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = () => setMenu(null);

  // Language index space for keyboard nav stays [source, ...targets] regardless
  // of view (nav only ever lands on target cells, index >= 1). What changes is
  // RENDERING: merged view drops the source as its own column (it moves into the
  // frozen Key/Source column), so only targets get value columns.
  const langs = sourceLanguage ? [sourceLanguage, ...targets] : targets;
  const valueLangs = merged ? targets : langs;

  const colWidth = (lang: string) => widths[lang] ?? DEFAULT_COL_WIDTH;
  const keyWidth =
    widths[KEY_COL_ID] ?? (merged ? DEFAULT_REF_WIDTH : DEFAULT_KEY_WIDTH);

  // Widths in render order: the frozen first column (Key/ref), then each value
  // column. The LAST column flexes to fill the pane; the rest are fixed px.
  const colWidths = [keyWidth, ...valueLangs.map(colWidth)];
  const lastIdx = colWidths.length - 1;
  const cols = colWidths
    .map((w, i) => (i === lastIdx ? `minmax(${w}px, 1fr)` : `${w}px`))
    .join(" ");
  // Grid grows to the SUM of column floors (→ horizontal scroll) only when the
  // fixed columns can't fit — instead of stretching to fit the longest cell on
  // one line. That lets the flexible last column WRAP within the pane.
  const minGridWidth = colWidths.reduce((s, w) => s + w, 0);
  // The frozen first column can host a resize handle only when a value column
  // follows it (otherwise it is itself the last/flex column).
  const firstResizable = valueLangs.length > 0;
  const lastValueIdx = valueLangs.length - 1;

  // The keyboard cursor / RO-measured heights depend on column WIDTHS too (text
  // wraps differently), but clearing the cache on every drag tick would thrash
  // the scrollbar. Visible rows self-correct live via the ResizeObserver; we
  // only bump this epoch when a resize settles, to refresh off-screen estimates.
  const [widthEpoch, setWidthEpoch] = useState(0);
  const commitResize = useCallback(() => setWidthEpoch((e) => e + 1), []);

  // Flatten entries into one row per variant; keys are stable across filters so
  // measured heights stay cached. The row key joins entry key + variant with a
  // NUL separator (written as an escape so the source stays plain text): catalog
  // keys are arbitrary strings that may contain spaces, so a printable separator
  // could collide and break React reconciliation / the height cache.
  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    entries.forEach((entry, entryIndex) => {
      const rows = entry.rows;
      if (rows.length > 1) {
        // Plural/device key -> header row + indented variant rows.
        out.push({
          entry,
          row: rows[0],
          kind: "header",
          entryIndex,
          lastInGroup: false,
          key: entry.key + "\u0000__header",
        });
        rows.forEach((row, i) => {
          out.push({
            entry,
            row,
            kind: "variant",
            entryIndex,
            lastInGroup: i === rows.length - 1,
            key: entry.key + "\u0000" + (row.variantKey || i),
          });
        });
      } else {
        const row = rows[0];
        out.push({
          entry,
          row,
          kind: "single",
          entryIndex,
          lastInGroup: true,
          key: entry.key + "\u0000" + (row?.variantKey || 0),
        });
      }
    });
    return out;
  }, [entries]);

  const keys = useMemo(() => flatRows.map((r) => r.key), [flatRows]);
  // Cached heights go stale when the rendered columns, the view mode, the widths
  // or the density change (cells wrap / pad differently) → fold them all into
  // the reset key.
  const colsKey = `${valueLangs.join("|")}|m:${merged ? 1 : 0}|d:${density}|w:${widthEpoch}`;
  const v = useRowVirtualizer(keys, ROW_ESTIMATE, colsKey);

  // ---- Keyboard navigation ----
  // The "active" cell is the keyboard cursor: highlighted, not yet editing.
  // Arrows move it; Enter/F2/typing edits. It is addressed by (key, lang,
  // variant) — stable across the async re-parse that follows every edit, unlike
  // a flatRows index. Navigation is restricted to target cells (col >= 1) on
  // non-header rows, i.e. exactly the cells a translator works in.
  const [active, setActive] = useState<EditingCell | null>(null);
  // A character that started an edit seeds the editor so the keystroke isn't
  // lost; null = started via click/Enter (select the existing text instead).
  const [editSeed, setEditSeed] = useState<string | null>(null);
  // The list is virtualized, so only KEYBOARD-driven cursor moves scroll the
  // active cell into view. Clicks land on a cell already in view, and a blur
  // commit re-points `active` at the just-edited cell (possibly scrolled far
  // away) — auto-scrolling to those would yank the viewport unexpectedly. So
  // each scroll-worthy move arms this flag; the effect below consumes it once.
  const scrollActiveIntoView = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      v.scrollRef(el);
    },
    [v.scrollRef]
  );
  const focusContainer = () => containerRef.current?.focus();
  // Click-to-select: move the keyboard cursor onto a cell and focus the grid so
  // the active ring shows + keyboard nav is ready. Does NOT arm the scroll flag,
  // so clicking never yanks the viewport (focusing the scroll container itself
  // doesn't move its scrollTop).
  const activate = useCallback((cell: EditingCell) => {
    setActive(cell);
    containerRef.current?.focus();
  }, []);

  // flatRows lookups (header rows skipped; targets are columns 1..n-1).
  const navRowIndex = (key: string, variantKey: string) =>
    flatRows.findIndex(
      (fr) =>
        fr.kind !== "header" &&
        fr.entry.key === key &&
        fr.row.variantKey === variantKey
    );
  const stepNavRow = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < flatRows.length; i += dir) {
      if (flatRows[i].kind !== "header") return i;
    }
    return -1;
  };
  const firstNavRow = () => stepNavRow(-1, 1);
  const cellAt = (r: number, c: number): EditingCell | null => {
    const fr = flatRows[r];
    const lang = langs[c];
    if (!fr || fr.kind === "header" || !lang || c < 1) return null;
    return { key: fr.entry.key, lang, variantKey: fr.row.variantKey };
  };
  const rowFor = (cell: EditingCell): CatalogRow | null => {
    const i = navRowIndex(cell.key, cell.variantKey);
    return i >= 0 ? flatRows[i].row : null;
  };
  const isEditableCell = (cell: EditingCell): boolean => {
    const i = navRowIndex(cell.key, cell.variantKey);
    return (
      i >= 0 &&
      flatRows[i].entry.shouldTranslate &&
      langs.indexOf(cell.lang) >= 1
    );
  };
  const moveTarget = (cell: EditingCell, move: Move): EditingCell | null => {
    const r = navRowIndex(cell.key, cell.variantKey);
    const c = langs.indexOf(cell.lang);
    if (r < 0 || c < 0) return null;
    const last = langs.length - 1;
    if (move === "down") {
      const nr = stepNavRow(r, 1);
      return nr >= 0 ? cellAt(nr, c) : null;
    }
    if (move === "right") {
      if (c < last) return cellAt(r, c + 1);
      const nr = stepNavRow(r, 1);
      return nr >= 0 ? cellAt(nr, 1) : null;
    }
    if (move === "left") {
      if (c > 1) return cellAt(r, c - 1);
      const nr = stepNavRow(r, -1);
      return nr >= 0 ? cellAt(nr, last) : null;
    }
    return null;
  };

  const startEdit = (cell: EditingCell, seed: string | null = null) => {
    setActive(cell);
    setEditSeed(seed);
    setEditing(cell);
  };
  const commitMove = (cell: EditingCell, value: string, move: Move) => {
    const row = rowFor(cell);
    const current = row?.cells[cell.lang]?.value ?? "";
    if (row && value !== current) {
      onSetValue(cell.key, cell.lang, row.segments, value);
    }
    setEditSeed(null);
    const next = moveTarget(cell, move);
    // Tab/Enter/Shift+Tab move the cursor on purpose → follow it. A blur
    // (move "none") just re-points active at the cell we left → don't scroll.
    if (move !== "none") scrollActiveIntoView.current = true;
    if (next && isEditableCell(next)) {
      // Chain straight into editing the destination (the fast translate flow).
      setActive(next);
      setEditing(next);
    } else {
      setActive(next ?? cell);
      setEditing(null);
      focusContainer();
    }
  };
  const cancelEdit = (cell: EditingCell) => {
    setEditSeed(null);
    setEditing(null);
    setActive(cell);
    focusContainer();
  };

  const moveActive = (dRow: -1 | 0 | 1, dCol: -1 | 0 | 1) => {
    // Arrow-key move → always keep the cursor in view.
    scrollActiveIntoView.current = true;
    let r = active ? navRowIndex(active.key, active.variantKey) : -1;
    let c = active ? langs.indexOf(active.lang) : -1;
    if (r < 0 || c < 1) {
      // No (or stale) cursor → land on the first navigable target cell.
      const f = firstNavRow();
      const first = f >= 0 ? cellAt(f, 1) : null;
      if (first) setActive(first);
      return;
    }
    if (dRow) {
      const nr = stepNavRow(r, dRow);
      if (nr >= 0) r = nr;
    }
    if (dCol) c = Math.min(langs.length - 1, Math.max(1, c + dCol));
    const next = cellAt(r, c);
    if (next) setActive(next);
  };

  // Keep the active cell on screen, but ONLY for keyboard-driven moves that
  // armed the flag (arrows, Tab/Enter chaining). Clicks and blur commits leave
  // it disarmed so the viewport stays put.
  useEffect(() => {
    if (!active || !scrollActiveIntoView.current) return;
    scrollActiveIntoView.current = false;
    const i = navRowIndex(active.key, active.variantKey);
    if (i >= 0) v.ensureVisible(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Editing / inline note / open menu own the keyboard; let them have it.
    if (editing || editingNote !== null || menu) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveActive(0, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveActive(0, -1);
        break;
      case "Enter":
      case "F2":
      case " ":
        if (active && isEditableCell(active)) {
          e.preventDefault();
          startEdit(active);
        }
        break;
      default:
        // Type-to-edit: a printable key opens the editor seeded with that char.
        if (
          active &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          isEditableCell(active)
        ) {
          e.preventDefault();
          startEdit(active, e.key);
        }
    }
  };
  // Tabbing into the grid with no cursor yet → highlight the first target cell.
  const onGridFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || active) return;
    const f = firstNavRow();
    const first = f >= 0 ? cellAt(f, 1) : null;
    if (first) setActive(first);
  };

  return (
    <QueryContext.Provider value={query}>
    <>
    <div
      className="grid-wrap"
      ref={setScrollRef}
      tabIndex={0}
      aria-label="Translations grid"
      onKeyDown={onGridKeyDown}
      onFocus={onGridFocus}
    >
      <div
        className="grid"
        style={{
          ["--cols" as string]: cols,
          // Sticky source column (split view) offsets itself by the key width.
          ["--col-key" as string]: `${keyWidth}px`,
          // Floor width so the flexible last column wraps instead of forcing
          // the whole grid wider than the pane (see minGridWidth).
          minWidth: `${minGridWidth}px`,
        }}
      >
        <div className="row head" ref={v.headRef}>
          {/* Frozen first column: "Key" (split) or the merged Key+Source — the
              merged header reads as the source language, since the cell shows
              the source value as its primary line. */}
          <div
            className={merged ? "cell key head-key ref-col" : "cell key head-key"}
          >
            {merged && sourceLanguage ? (
              <div className="head-top">
                <span
                  className="head-lang"
                  title={`${langName(sourceLanguage)} (${sourceLanguage})`}
                >
                  <span className="head-name">{langName(sourceLanguage)}</span>
                  <span className="head-code">{sourceLanguage}</span>
                </span>
                <span className="lang-tag">source</span>
              </div>
            ) : (
              "Key"
            )}
            {firstResizable && (
              <ColResizer
                colId={KEY_COL_ID}
                width={keyWidth}
                min={MIN_KEY_WIDTH}
                label={merged ? "Source" : "Key"}
                onResize={onResize}
                onReset={onResetWidth}
                onCommit={commitResize}
              />
            )}
          </div>
          {valueLangs.map((lang, i) => {
            const isSource = lang === sourceLanguage;
            const p = progress[lang];
            return (
              <div
                key={lang}
                className={isSource ? "cell col-source" : "cell head-cell"}
              >
                <div className="head-top">
                  <span
                    className="head-lang"
                    title={`${langName(lang)} (${lang})`}
                  >
                    <span className="head-name">{langName(lang)}</span>
                    <span className="head-code">{lang}</span>
                  </span>
                  {isSource ? (
                    <span className="lang-tag">source</span>
                  ) : (
                    p && <span className="head-pct">{p.percent}%</span>
                  )}
                </div>
                {!isSource && p && (
                  <div
                    className="head-prog"
                    title={`${lang}: ${p.translated}/${p.total} translated${
                      p.needsReview ? `, ${p.needsReview} needs review` : ""
                    }`}
                  >
                    <div
                      className="head-prog-fill"
                      style={{ width: `${p.percent}%` }}
                    />
                  </div>
                )}
                {i !== lastValueIdx && (
                  <ColResizer
                    colId={lang}
                    width={colWidth(lang)}
                    min={MIN_COL_WIDTH}
                    label={langName(lang)}
                    onResize={onResize}
                    onReset={onResetWidth}
                    onCommit={commitResize}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="grid-body" ref={v.bodyRef}>
          {flatRows.length === 0 ? (
            <div className="grid-empty">No keys match the search or filter.</div>
          ) : (
            <>
              {v.padTop > 0 && (
                <div
                  className="grid-spacer"
                  style={{ height: v.padTop }}
                  aria-hidden
                />
              )}
              {flatRows.slice(v.start, v.end).map((fr) => {
                return (
                  <RowView
                    key={fr.key}
                    vkey={fr.key}
                    itemRef={v.itemRef}
                    entry={fr.entry}
                    row={fr.row}
                    kind={fr.kind}
                    lastInGroup={fr.lastInGroup}
                    zebra={fr.entryIndex % 2 === 0}
                    valueLangs={valueLangs}
                    merged={merged}
                    sourceLanguage={sourceLanguage}
                    baseline={baseline}
                    editing={editing}
                    active={active}
                    editSeed={editSeed}
                    doubleClickToEdit={doubleClickToEdit}
                    caps={caps}
                    unused={!!usage && usage[fr.entry.key] === 0}
                    onActivate={activate}
                    onStartEdit={startEdit}
                    onCommitMove={commitMove}
                    onCancelEdit={cancelEdit}
                    editingNote={editingNote === fr.entry.key}
                    setEditingNote={setEditingNote}
                    onSetComment={onSetComment}
                    setMenu={setMenu}
                  />
                );
              })}
              {v.padBottom > 0 && (
                <div
                  className="grid-spacer"
                  style={{ height: v.padBottom }}
                  aria-hidden
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {menu?.kind === "string" && (
      <Menu pos={menu.pos} onClose={closeMenu} ariaLabel="String actions">
        <MenuItem
          label="Find in code"
          icon={<SearchIcon size={13} />}
          onSelect={() => {
            onFindInCode(menu.entry.key);
            closeMenu();
          }}
        />
        {(caps.editComment || caps.shouldTranslate) && <MenuSeparator />}
        {caps.editComment && (
          <>
            <MenuItem
              label={menu.entry.comment ? "Edit note…" : "Add note…"}
              onSelect={() => {
                setEditingNote(menu.entry.key);
                closeMenu();
              }}
            />
            {menu.entry.comment && (
              <MenuItem
                label="Remove note"
                onSelect={() => {
                  onSetComment(menu.entry.key, "");
                  closeMenu();
                }}
              />
            )}
          </>
        )}
        {caps.editComment && caps.shouldTranslate && <MenuSeparator />}
        {caps.shouldTranslate && (
          <MenuItem
            label="Don't translate"
            checked={!menu.entry.shouldTranslate}
            onSelect={() => {
              onSetShouldTranslate(menu.entry.key, !menu.entry.shouldTranslate);
              closeMenu();
            }}
          />
        )}
      </Menu>
    )}

    {menu?.kind === "cell" &&
      caps.reviewState &&
      (() => {
        const cell = menu.row.cells[menu.lang];
        const canState = !!cell && cell.value.trim() !== "";
        const st = cell?.state ?? "translated";
        return (
          <Menu pos={menu.pos} onClose={closeMenu} ariaLabel="Review state">
            <MenuItem
              label="Mark as Reviewed"
              checked={canState && st === "translated"}
              disabled={!canState}
              onSelect={() => {
                onSetState(
                  menu.entry.key,
                  menu.lang,
                  menu.row.segments,
                  "translated"
                );
                closeMenu();
              }}
            />
            <MenuItem
              label="Mark as Needs Review"
              checked={canState && st === "needs_review"}
              disabled={!canState}
              onSelect={() => {
                onSetState(
                  menu.entry.key,
                  menu.lang,
                  menu.row.segments,
                  "needs_review"
                );
                closeMenu();
              }}
            />
          </Menu>
        );
      })()}
    </>
    </QueryContext.Provider>
  );
}

interface RowViewProps {
  /** Stable key for this row (used to look up its measured height). */
  vkey: string;
  /** Virtualizer's measure-ref factory (stable identity). */
  itemRef: (key: string) => (el: HTMLElement | null) => void;
  entry: CatalogEntry;
  row: CatalogRow;
  /** "single" key, plural/device "header", or one variant "row". */
  kind: RowKind;
  /** Last row of the key's group → keeps the bottom divider. */
  lastInGroup: boolean;
  /** Alternate background (per entry, so a key's rows shade as one block). */
  zebra: boolean;
  /** Languages that get their own value column (targets only in merged view). */
  valueLangs: string[];
  /** Merged view → render the RefCell (Key+Source) instead of a Key cell. */
  merged: boolean;
  sourceLanguage: string;
  baseline: Baseline | null;
  /** The cell being edited (open textarea), if any. */
  editing: EditingCell | null;
  /** The keyboard-cursor cell (highlighted), if any. */
  active: EditingCell | null;
  /** Char that seeded the current edit (only meaningful for the editing cell). */
  editSeed: string | null;
  /** When true, a single click selects a cell; a double-click opens the editor. */
  doubleClickToEdit: boolean;
  /** Per-format feature gates. */
  caps: Capabilities;
  /** This key had 0 code references in the last scan → flag it "unused". */
  unused: boolean;
  /** Move the keyboard cursor onto a cell (click / right-click). */
  onActivate(cell: EditingCell): void;
  /** Open the editor on a cell (optionally seeded with a typed char). */
  onStartEdit(cell: EditingCell, seed?: string | null): void;
  /** Commit an edit and move the cursor per {@link Move}. */
  onCommitMove(cell: EditingCell, value: string, move: Move): void;
  /** Cancel an edit, leaving the cursor on the cell. */
  onCancelEdit(cell: EditingCell): void;
  /** True when THIS entry's note is being edited inline. */
  editingNote: boolean;
  setEditingNote(key: string | null): void;
  onSetComment(key: string, comment: string): void;
  setMenu(menu: MenuState): void;
}

function RowView({
  vkey,
  itemRef,
  entry,
  row,
  kind,
  lastInGroup,
  zebra,
  valueLangs,
  merged,
  sourceLanguage,
  baseline,
  editing,
  active,
  editSeed,
  doubleClickToEdit,
  caps,
  unused,
  onActivate,
  onStartEdit,
  onCommitMove,
  onCancelEdit,
  editingNote,
  setEditingNote,
  onSetComment,
  setMenu,
}: RowViewProps) {
  // Memoize the measure-ref so its identity is stable across re-renders (scroll
  // re-renders this row). Otherwise React would re-invoke the ref every render
  // and the offsetHeight read inside would force a reflow per scroll frame.
  const setRef = useMemo(
    () => itemRef(vkey) as (el: HTMLDivElement | null) => void,
    [itemRef, vkey]
  );
  // Keys marked shouldTranslate:false (e.g. pure format strings) are not meant
  // to be translated → not editable, shown dimmed with an em dash.
  const translatable = entry.shouldTranslate;
  const emptyText = translatable ? "(untranslated)" : "—";
  // Source value for format comparison: the source localization. For xcstrings
  // the key is the implicit source string (keyAsSource); for .strings the key
  // is an identifier, so without a real source value there's nothing to compare.
  const sourceValue = caps.keyAsSource
    ? row.cells[sourceLanguage]?.value ?? entry.key
    : row.cells[sourceLanguage]?.value;

  // Orphaned: a key in this (target) file with no counterpart in the source
  // language — likely removed upstream. Only flagged where keys can drift from a
  // source file (.strings) and a real source column exists.
  const isOrphan =
    caps.orphanKeys &&
    sourceLanguage !== "" &&
    kind !== "header" &&
    row.cells[sourceLanguage] === undefined;

  const cls = [
    translatable ? "row" : "row row-excluded",
    zebra ? "row-zebra" : "",
    // Non-final rows of a group drop their divider so the key reads as a block.
    lastInGroup ? "" : "group-mid",
    kind === "header" ? "row-keyheader" : "",
    kind === "variant" ? "row-variant" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The key menu always offers "Find in code"; the note / don't-translate items
  // are layered on top for formats that support them. So the menu — and its
  // kebab / right-click trigger — is available for every format, including
  // .strings (which has neither note nor don't-translate).
  const openStringMenu = (pos: MenuPos) =>
    setMenu({ kind: "string", entry, pos });

  const noteProps = {
    editingNote,
    canEditComment: caps.editComment,
    onNoteEditStart: () => setEditingNote(entry.key),
    onNoteCommit: (val: string) => {
      if ((entry.comment ?? "") !== val) onSetComment(entry.key, val);
      setEditingNote(null);
    },
    onNoteCancel: () => setEditingNote(null),
  };

  // Frozen first column. Merged view: one RefCell (source value + key + note +
  // flags). Split view: the classic Key cell (or a variant form label).
  const firstCell = merged ? (
    <RefCell
      entry={entry}
      row={row}
      kind={kind}
      sourceLanguage={sourceLanguage}
      isOrphan={isOrphan}
      isUnused={unused}
      onOpenMenu={openStringMenu}
      {...noteProps}
    />
  ) : kind === "variant" ? (
    <VariantKeyCell row={row} onOpenMenu={openStringMenu} />
  ) : (
    <KeyHeaderCell
      entry={entry}
      isOrphan={isOrphan}
      isUnused={unused}
      onOpenMenu={openStringMenu}
      {...noteProps}
    />
  );

  // Header row of a plural/device key: just the first column + its actions; the
  // value columns stay empty (each form is rendered on its own variant row).
  if (kind === "header") {
    return (
      <div className={cls} ref={setRef}>
        {firstCell}
        {valueLangs.map((lang) => (
          <div
            key={lang}
            className={lang === sourceLanguage ? "cell col-source" : "cell"}
          />
        ))}
      </div>
    );
  }

  const valueCells = valueLangs.map((lang) => {
    const cell = row.cells[lang];
    const isSource = lang === sourceLanguage;
    // Plural/device variant cells are editable too: only the source column and
    // excluded keys stay read-only.
    const editable = !isSource && translatable;
    const warn = isSource ? null : computeWarn(sourceValue, cell?.value);

    // Changed-since-commit marker (target columns only — the source column is
    // sticky/positioned and not edited here).
    const base =
      !isSource && baseline
        ? baselineCell(baseline, entry.key, lang, row.variantKey)
        : undefined;
    const change =
      !isSource && baseline ? cellChange(base, cell) : "none";
    const changeKind = change === "none" ? undefined : change;
    const oldValue = base?.value ?? "";

    // Review-state menu: any existing non-source cell can be (re)stated — but
    // only when the format supports review state (.strings does not).
    const onMenu =
      !isSource && cell && caps.reviewState
        ? (pos: MenuPos) => setMenu({ kind: "cell", entry, row, lang, pos })
        : undefined;

    // Keyboard cursor lives on target cells only (the source column is sticky
    // and read-only — never the active cell).
    const cellId: EditingCell = { key: entry.key, lang, variantKey: row.variantKey };
    const isActive =
      !isSource &&
      !!active &&
      active.key === entry.key &&
      active.lang === lang &&
      active.variantKey === row.variantKey;

    if (!editable) {
      return (
        <ReadonlyCell
          key={lang}
          cell={cell}
          fallback={isSource ? entry.key : undefined}
          warn={warn}
          emptyText={emptyText}
          sticky={isSource}
          onMenu={onMenu}
          active={isActive}
          onActivate={isSource ? undefined : () => onActivate(cellId)}
          changeKind={changeKind}
          oldValue={oldValue}
        />
      );
    }

    const isEditing =
      !!editing &&
      editing.key === entry.key &&
      editing.lang === lang &&
      editing.variantKey === row.variantKey;
    return (
      <EditableCell
        key={lang}
        cell={cell}
        warn={warn}
        editing={isEditing}
        active={isActive}
        seed={isEditing ? editSeed : null}
        doubleClickToEdit={doubleClickToEdit}
        onStart={() => onStartEdit(cellId)}
        onActivate={() => onActivate(cellId)}
        onResolve={(val, move) => onCommitMove(cellId, val, move)}
        onCancel={() => onCancelEdit(cellId)}
        onMenu={onMenu}
        changeKind={changeKind}
        oldValue={oldValue}
      />
    );
  });

  return (
    <div className={cls} ref={setRef}>
      {firstCell}
      {valueCells}
    </div>
  );
}

/** Small kebab trigger shown on hover in a cell / key header. */
function Kebab({
  onOpen,
  label,
  className,
}: {
  onOpen(pos: MenuPos): void;
  label: string;
  className: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(posBelow(e.currentTarget));
      }}
    >
      <KebabIcon size={14} />
    </button>
  );
}

/** A key's developer note: inline-editable when the format supports it, else
 * read-only display (or nothing when there's no comment). */
function KeyNote({
  comment,
  editingNote,
  canEditComment,
  onEditStart,
  onCommit,
  onCancel,
}: {
  comment?: string;
  editingNote: boolean;
  canEditComment: boolean;
  onEditStart(): void;
  onCommit(value: string): void;
  onCancel(): void;
}) {
  const query = useContext(QueryContext);
  if (canEditComment && editingNote) {
    return (
      <NoteEditor initial={comment ?? ""} onCommit={onCommit} onCancel={onCancel} />
    );
  }
  if (!comment) return null;
  if (!canEditComment) {
    return (
      <div className="key-comment">
        <Highlight text={comment} query={query} />
      </div>
    );
  }
  return (
    <div className="key-comment editable" title="Click to edit note" onClick={onEditStart}>
      <Highlight text={comment} query={query} />
    </div>
  );
}

/**
 * Merged Key+Source column (merged view). Shows the source string as the
 * primary line and the key as a muted mono secondary line ONLY when it differs
 * (the common "key == source" case shows the text once → no duplication), plus
 * the note + flags + actions. Plural/device keys: the header row shows the key
 * (it has no single source string), and each variant row shows its form label
 * followed by that form's source value. `onOpenMenu` is omitted when the format
 * has no key actions (e.g. .strings).
 */
function RefCell({
  entry,
  row,
  kind,
  sourceLanguage,
  isOrphan,
  isUnused,
  onOpenMenu,
  editingNote,
  canEditComment,
  onNoteEditStart,
  onNoteCommit,
  onNoteCancel,
}: {
  entry: CatalogEntry;
  row: CatalogRow;
  kind: RowKind;
  sourceLanguage: string;
  isOrphan?: boolean;
  isUnused?: boolean;
  onOpenMenu?: (pos: MenuPos) => void;
  editingNote: boolean;
  canEditComment: boolean;
  onNoteEditStart(): void;
  onNoteCommit(value: string): void;
  onNoteCancel(): void;
}) {
  const query = useContext(QueryContext);
  const isVariant = kind === "variant";
  const isHeader = kind === "header";
  const srcValue = row.cells[sourceLanguage]?.value;
  // For a single key the implicit source is the key itself → only surface the
  // key on its own line when it carries info beyond the shown source string.
  const singleSource = srcValue ?? entry.key;
  const showKey = !isVariant && !isHeader && entry.key !== singleSource;

  return (
    <div
      className={"cell key ref-col" + (isVariant ? " key-variant" : "")}
      onContextMenu={
        onOpenMenu
          ? (e) => {
              e.preventDefault();
              onOpenMenu(posFromCursor(e));
            }
          : undefined
      }
    >
      {isVariant ? (
        <>
          <div className="variant-label">{row.variantLabel}</div>
          {srcValue !== undefined && srcValue.trim() !== "" && (
            <div className="cell-value ref-source">
              <FormatValue value={srcValue} />
            </div>
          )}
        </>
      ) : isHeader ? (
        <div className="key-head">
          <div className="key-name">
            <Highlight text={entry.key} query={query} />
          </div>
          {onOpenMenu && (
            <Kebab onOpen={onOpenMenu} label="Key actions" className="row-kebab" />
          )}
        </div>
      ) : (
        <>
          <div className="key-head">
            <div className="cell-value ref-source">
              <FormatValue value={singleSource} />
            </div>
            {onOpenMenu && (
              <Kebab onOpen={onOpenMenu} label="Key actions" className="row-kebab" />
            )}
          </div>
          {showKey && (
            <div className="ref-key" title={`Key: ${entry.key}`}>
              <Highlight text={entry.key} query={query} />
            </div>
          )}
        </>
      )}
      {!isVariant && (
        <KeyNote
          comment={entry.comment}
          editingNote={editingNote}
          canEditComment={canEditComment}
          onEditStart={onNoteEditStart}
          onCommit={onNoteCommit}
          onCancel={onNoteCancel}
        />
      )}
      {!isVariant && (isOrphan || isUnused || !entry.shouldTranslate) && (
        <div className="key-flags">
          {isOrphan && <OrphanFlag />}
          {isUnused && <UnusedFlag />}
          {!entry.shouldTranslate && (
            <span className="flag flag-muted">don't translate</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Badge for a key with no source-language counterpart (a `.strings` orphan). */
function OrphanFlag() {
  return (
    <span
      className="flag flag-orphan"
      title="No entry in the source language — this key may have been removed upstream. Safe to delete if it's unused."
    >
      orphaned
    </span>
  );
}

/** Badge for a key the last code scan found no literal reference for — a likely
 * dead translation. Worded as "verify, don't blindly delete": keys built by
 * string interpolation or referenced from storyboards won't be detected. */
function UnusedFlag() {
  return (
    <span
      className="flag flag-unused"
      title="No reference found in your Swift/Obj-C code. It might still be used via string interpolation, storyboards/XIBs, or built at runtime — verify before deleting."
    >
      unused
    </span>
  );
}

/** Key column for a "single" key or the "header" row of a plural/device key. */
function KeyHeaderCell({
  entry,
  isOrphan,
  isUnused,
  onOpenMenu,
  editingNote,
  canEditComment,
  onNoteEditStart,
  onNoteCommit,
  onNoteCancel,
}: {
  entry: CatalogEntry;
  isOrphan?: boolean;
  isUnused?: boolean;
  onOpenMenu?: (pos: MenuPos) => void;
  editingNote: boolean;
  canEditComment: boolean;
  onNoteEditStart(): void;
  onNoteCommit(value: string): void;
  onNoteCancel(): void;
}) {
  const query = useContext(QueryContext);
  return (
    <div
      className="cell key key-actionable"
      onContextMenu={
        onOpenMenu
          ? (e) => {
              e.preventDefault();
              onOpenMenu(posFromCursor(e));
            }
          : undefined
      }
    >
      <div className="key-head">
        <div className="key-name">
          <Highlight text={entry.key} query={query} />
        </div>
        {onOpenMenu && (
          <Kebab onOpen={onOpenMenu} label="Key actions" className="row-kebab" />
        )}
      </div>
      <KeyNote
        comment={entry.comment}
        editingNote={editingNote}
        canEditComment={canEditComment}
        onEditStart={onNoteEditStart}
        onCommit={onNoteCommit}
        onCancel={onNoteCancel}
      />
      {(isOrphan || isUnused || !entry.shouldTranslate) && (
        <div className="key-flags">
          {isOrphan && <OrphanFlag />}
          {isUnused && <UnusedFlag />}
          {!entry.shouldTranslate && (
            <span className="flag flag-muted">don't translate</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Key column for one variant sub-row: the form label, indented under the key
 * with a group guide bar (see .key-variant). Right-click still opens the key's
 * actions (the variant belongs to the same key). */
function VariantKeyCell({
  row,
  onOpenMenu,
}: {
  row: CatalogRow;
  onOpenMenu?: (pos: MenuPos) => void;
}) {
  return (
    <div
      className="cell key key-variant"
      onContextMenu={
        onOpenMenu
          ? (e) => {
              e.preventDefault();
              onOpenMenu(posFromCursor(e));
            }
          : undefined
      }
    >
      <div className="variant-label">{row.variantLabel}</div>
    </div>
  );
}

/** Inline editor for a key's developer note (comment). */
function NoteEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(value: string): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <textarea
      ref={ref}
      className="note-input"
      value={draft}
      rows={1}
      placeholder="Note for translators…"
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(draft.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(draft.trim())}
    />
  );
}

/** Changed-since-commit marker class + hover title (showing the old value). */
type ChangeKind = "added" | "modified";
function changeClass(kind?: ChangeKind): string {
  return kind === "added"
    ? " cell-added"
    : kind === "modified"
    ? " cell-changed"
    : "";
}
function changeTitle(kind?: ChangeKind, oldValue?: string): string | undefined {
  if (!kind) return undefined;
  if (kind === "added") return "Added since last commit";
  const was = oldValue && oldValue.trim() !== "" ? oldValue : "(empty)";
  return `Changed since last commit · was: ${was}`;
}

/** Read-only cell: source, or a variant cell. */
function ReadonlyCell({
  cell,
  fallback,
  warn,
  emptyText = "(untranslated)",
  sticky,
  onMenu,
  active,
  onActivate,
  changeKind,
  oldValue,
}: {
  cell: CatalogCell | undefined;
  fallback?: string;
  warn?: FormatWarn | null;
  emptyText?: string;
  sticky?: boolean;
  onMenu?: (pos: MenuPos) => void;
  active?: boolean;
  onActivate?: () => void;
  changeKind?: ChangeKind;
  oldValue?: string;
}) {
  const base = sticky ? "cell col-source" : "cell";
  const activeCls = active ? " cell-active" : "";
  if (!cell) {
    // Source localization missing → the implicit source value is the key.
    if (fallback !== undefined) {
      return (
        <div className={base}>
          <div className="cell-value cell-source-fallback">
            <FormatValue value={fallback} />
          </div>
        </div>
      );
    }
    return (
      <div className={`${base} cell-missing${activeCls}`} onClick={onActivate}>
        {emptyText}
      </div>
    );
  }
  const isEmpty = cell.value.trim() === "";
  let cls = warn ? `${base} cell-warn-box` : base;
  if (onMenu) cls += " cell-has-menu";
  cls += changeClass(changeKind);
  cls += activeCls;
  return (
    <div
      className={cls}
      title={changeTitle(changeKind, oldValue)}
      onClick={onActivate}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(posFromCursor(e));
            }
          : undefined
      }
    >
      <div className={isEmpty ? "cell-value cell-empty" : "cell-value"}>
        {isEmpty ? emptyText : <FormatValue value={cell.value} />}
      </div>
      <StateBadge state={cell.state} />
      {warn && <FormatWarning warn={warn} />}
      {onMenu && <Kebab onOpen={onMenu} label="Review state" className="cell-kebab" />}
    </div>
  );
}

/** Badge for cells that need attention. Translated is the norm → no badge. */
function StateBadge({ state }: { state?: string }) {
  if (!state || state === "translated") return null;
  return (
    <div className="cell-foot">
      <span className={`badge badge-${state}`}>{stateLabel(state)}</span>
    </div>
  );
}

/** Editable target cell: click → textarea; Enter saves, Esc cancels, blur saves. */
function EditableCell({
  cell,
  warn,
  editing,
  active,
  seed,
  doubleClickToEdit,
  onStart,
  onActivate,
  onResolve,
  onCancel,
  onMenu,
  changeKind,
  oldValue,
}: {
  cell: CatalogCell | undefined;
  warn: FormatWarn | null;
  editing: boolean;
  active?: boolean;
  seed: string | null;
  /** When true, a single click only selects the cell; a double-click edits. */
  doubleClickToEdit: boolean;
  onStart(): void;
  /** Move the keyboard cursor onto this cell without opening the editor. */
  onActivate(): void;
  onResolve(value: string, move: Move): void;
  onCancel(): void;
  onMenu?: (pos: MenuPos) => void;
  changeKind?: ChangeKind;
  oldValue?: string;
}) {
  if (editing) {
    return (
      <CellEditor
        initial={cell?.value ?? ""}
        seed={seed}
        onResolve={onResolve}
        onCancel={onCancel}
      />
    );
  }

  const isEmpty = !cell || cell.value.trim() === "";
  let cls = warn ? "cell cell-editable cell-warn-box" : "cell cell-editable";
  if (onMenu) cls += " cell-has-menu";
  cls += changeClass(changeKind);
  if (active) cls += " cell-active";
  const editHint = doubleClickToEdit ? "double-click to edit" : "click to edit";
  const title = changeKind
    ? `${changeTitle(changeKind, oldValue)} · ${editHint}`
    : editHint.charAt(0).toUpperCase() + editHint.slice(1);
  return (
    <div
      className={cls}
      onClick={doubleClickToEdit ? onActivate : onStart}
      onDoubleClick={doubleClickToEdit ? onStart : undefined}
      title={title}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(posFromCursor(e));
            }
          : undefined
      }
    >
      <div className={isEmpty ? "cell-value cell-empty" : "cell-value"}>
        {isEmpty ? "(untranslated)" : <FormatValue value={cell!.value} />}
      </div>
      <StateBadge state={cell?.state} />
      {warn && <FormatWarning warn={warn} />}
      {onMenu && <Kebab onOpen={onMenu} label="Review state" className="cell-kebab" />}
    </div>
  );
}

function CellEditor({
  initial,
  seed,
  onResolve,
  onCancel,
}: {
  initial: string;
  /** Char that opened the editor (type-to-edit) → start from it; null = select
   * the existing text so the first keystroke replaces it. */
  seed: string | null;
  onResolve(value: string, move: Move): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(seed != null ? seed : initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Enter / Tab / Escape and blur can all fire for one editor (blur follows the
  // others as it unmounts). Resolve exactly once.
  const done = useRef(false);
  const finish = (move: Move | null) => {
    if (done.current) return;
    done.current = true;
    if (move === null) onCancel();
    else onResolve(draft, move);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (seed != null) {
      // Typed char already in the draft → keep typing after it.
      const n = el.value.length;
      el.setSelectionRange(n, n);
    } else {
      el.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-grow to fit content.
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <div className="cell cell-editing">
      <textarea
        ref={ref}
        className="cell-input"
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish("down");
          } else if (e.key === "Tab") {
            e.preventDefault();
            finish(e.shiftKey ? "left" : "right");
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={() => finish("none")}
      />
    </div>
  );
}
