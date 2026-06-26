import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  HostToWebview,
  WebviewToHost,
  Settings,
  Capabilities,
} from "../src/shared/protocol";
import type { Catalog } from "../src/shared/xcstrings";
import { parseCatalog } from "../src/shared/xcstrings";
import { diffSpecifiers } from "../src/shared/format";
import { allLanguageProgress } from "../src/shared/progress";
import {
  filterEntries,
  filterCounts,
  type RowFilter,
} from "../src/shared/filter";
import { searchEntries } from "../src/shared/search";
import {
  buildBaseline,
  baselineCell,
  cellChange,
  type Baseline,
} from "./diff";
import { Grid } from "./Grid";
import { LanguagePicker } from "./LanguagePicker";
import {
  SearchIcon,
  CloseIcon,
  WarningIcon,
  InfoIcon,
  LoadingIcon,
  DensityIcon,
  ColumnsIcon,
  ScanIcon,
} from "./icons";
import { gridStyles } from "./gridStyles";

// The API VSCode injects into the webview (call acquireVsCodeApi exactly once).
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function post(msg: WebviewToHost) {
  vscode.postMessage(msg);
}

function postOpenAsText() {
  post({ type: "openAsText" });
}

/** Find a key's usages in source code (opens VSCode's search scoped to .swift). */
function postFindInCode(key: string) {
  post({ type: "findInCode", key });
}

function postSetValue(
  key: string,
  lang: string,
  segments: string[],
  value: string
) {
  post({ type: "setValue", key, lang, segments, value });
}

function postSetComment(key: string, comment: string) {
  post({ type: "setComment", key, comment });
}

function postSetShouldTranslate(key: string, value: boolean) {
  post({ type: "setShouldTranslate", key, value });
}

function postSetState(
  key: string,
  lang: string,
  segments: string[],
  state: string
) {
  post({ type: "setState", key, lang, segments, state });
}

/** Persist a display option to the user settings (the toolbar toggles). */
function postSetSettings(settings: Partial<Settings>) {
  post({ type: "setSettings", settings });
}

/** Row spacing: "comfortable" (default) or "compact" (tighter, more rows). */
type Density = "comfortable" | "compact";

/** Column layout: "merged" (default) folds the source value into one frozen
 * column with the key; "split" keeps a separate Key and source column. */
type ViewMode = "merged" | "split";

/** Per-column pixel widths, keyed by column id (the grid's KEY_COL_ID or a
 * language code). Absent entries fall back to the layout defaults in Grid.tsx. */
type ColWidths = Record<string, number>;

// Density + view mode live in the user settings (host-driven), not here. This
// webview state only holds the per-file layout the user shapes by hand.
interface PersistedState {
  /** null = never chosen → use the default; [] = intentionally cleared. */
  targets: string[] | null;
  /** Column widths the user dragged (empty = all at default). */
  widths: ColWidths;
}

function loadState(): PersistedState {
  const s = vscode.getState() as PersistedState | null;
  return {
    targets: s?.targets ?? null,
    widths: s?.widths ?? {},
  };
}

/** Default: the first target language (the first non-source column). */
function defaultTargets(catalog: Catalog): string[] {
  const nonSource = catalog.languages.filter(
    (l) => l !== catalog.sourceLanguage
  );
  return nonSource.length === 0 ? [] : [nonSource[0]];
}

/** Count all cells (every target language, including hidden columns) whose
 * format specifiers diverge from the source. When `keyAsSource` is false
 * (.strings) the key is NOT used as a stand-in source, so a file with no real
 * source value (e.g. the source-language file itself) yields no warnings. */
function countFormatWarnings(catalog: Catalog, keyAsSource: boolean): number {
  const src = catalog.sourceLanguage;
  let n = 0;
  for (const entry of catalog.entries) {
    for (const row of entry.rows) {
      const sourceValue = keyAsSource
        ? row.cells[src]?.value ?? entry.key
        : row.cells[src]?.value;
      if (sourceValue === undefined) continue;
      for (const lang of Object.keys(row.cells)) {
        if (lang === src) continue;
        const value = row.cells[lang]?.value;
        if (!value || value.trim() === "") continue;
        if (!diffSpecifiers(sourceValue, value).ok) n++;
      }
    }
  }
  return n;
}

/** Filters shown as tabs. "changed" (vs git HEAD) is added only when a baseline
 * is available. */
type UiFilter = RowFilter | "changed" | "unused";

const BASE_FILTERS: { id: UiFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "untranslated", label: "Untranslated" },
  { id: "needs_review", label: "Needs review" },
  { id: "warnings", label: "Warnings" },
];

function FilterBar({
  value,
  counts,
  filters,
  onChange,
}: {
  value: UiFilter;
  counts: Record<UiFilter, number>;
  filters: { id: UiFilter; label: string }[];
  onChange(f: UiFilter): void;
}) {
  return (
    <div className="filterbar" role="group" aria-label="Filter rows">
      {filters.map((f) => {
        const count = counts[f.id] ?? 0;
        return (
          <button
            key={f.id}
            type="button"
            className={"filter-tab" + (value === f.id ? " active" : "")}
            aria-pressed={value === f.id}
            onClick={() => onChange(f.id)}
          >
            {f.id === "warnings" && count > 0 && <WarningIcon size={12} />}
            <span className="tab-label">{f.label}</span>
            <span className="tab-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Free-text search box (filters rows by key / comment / any value), styled like
 * VSCode Settings' search field: a bordered field with a leading magnifier and
 * inline trailing actions (clear, then the `children` language chip).
 */
function SearchBox({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange(q: string): void;
  /** Trailing inline controls (e.g. the language chip). */
  children?: ReactNode;
}) {
  return (
    <div className="search">
      <span className="search-icon" aria-hidden>
        <SearchIcon size={13} />
      </span>
      <input
        type="search"
        className="search-input"
        placeholder="Search keys & values…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        aria-label="Search keys and values"
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => onChange("")}
        >
          <CloseIcon size={13} />
        </button>
      )}
      {children}
    </div>
  );
}

/** Catalog stats tucked behind an info button (data the user already knows). */
function CatalogInfo({
  sourceLanguage,
  keyCount,
  langCount,
  warnCount,
}: {
  sourceLanguage: string;
  keyCount: number;
  langCount: number;
  warnCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="info-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Catalog info"
        title="Catalog info"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <InfoIcon size={14} />
      </button>
      {open && (
        <div className="info-popover" role="menu">
          <dl className="info-list">
            <dt>Source</dt>
            <dd>{sourceLanguage || "—"}</dd>
            <dt>Keys</dt>
            <dd>{keyCount}</dd>
            <dt>Languages</dt>
            <dd>{langCount}</dd>
            <dt>Format warnings</dt>
            <dd>{warnCount}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

/** Once the loading indicator appears, hold it at least this long so a fast load
 * doesn't flash it on and off (anti-flicker min-dwell). */
const MIN_LOADING_MS = 800;

export function App() {
  const [text, setText] = useState<string>("");
  // Whether the host has sent the file text yet. Before it does, `text` is ""
  // which parses to zero keys — without this flag a still-loading heavy file
  // looks identical to a genuinely empty catalog ("no keys yet").
  const [received, setReceived] = useState(false);
  // What the UI actually reads to show the loader. It trails `received` by a
  // minimum dwell (MIN_LOADING_MS) so a quick load doesn't flicker the spinner.
  const [showLoading, setShowLoading] = useState(true);
  const loadingShownAt = useRef(Date.now());
  // File content at git HEAD (the diff baseline); null = no git / untracked.
  // .xcstrings ships text (parsed here); .strings ships a prebuilt catalog.
  const [baselineText, setBaselineText] = useState<string | null>(null);
  const [baselineModel, setBaselineModel] = useState<Catalog | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(
    () => loadState().targets
  );
  const [widths, setWidths] = useState<ColWidths>(() => loadState().widths);
  // Workspace's most-recently-used column set (host-driven). A file that was
  // never explicitly chosen inherits this instead of the first language.
  const [inherited, setInherited] = useState<string[] | null>(null);
  // True once the host has sent the authoritative saved layout. We don't persist
  // before then, so the initial mount can't clobber the stored choice.
  const [hydrated, setHydrated] = useState(false);
  // Density + view + edit-gesture come from the user settings (host-driven).
  // Start at the documented defaults; the host sends the real values on "ready".
  const [density, setDensity] = useState<Density>("comfortable");
  const [viewMode, setViewMode] = useState<ViewMode>("merged");
  const [doubleClickToEdit, setDoubleClickToEdit] = useState(true);
  // For .strings the host ships a prebuilt catalog (it aggregates the opened
  // file + its source sibling); for .xcstrings the webview parses `text` itself.
  const [model, setModel] = useState<Catalog | null>(null);
  // Per-format feature gates; default to the full .xcstrings set until the host
  // sends the real capabilities on ready.
  const [caps, setCaps] = useState<Capabilities>({
    reviewState: true,
    shouldTranslate: true,
    editComment: true,
    diff: true,
    chooseColumns: true,
    orphanKeys: false,
    keyAsSource: true,
  });
  const [filter, setFilter] = useState<UiFilter>("all");
  const [query, setQuery] = useState("");
  // The file was rewritten on disk while we have unsaved edits (host-detected).
  // Surfaces a conflict banner; cleared once the user picks Reload or Keep mine.
  const [externalChange, setExternalChange] = useState(false);
  // On-demand code-usage scan (Plan B). `usage[key]` = literal references found
  // in the workspace's Swift/Obj-C source; null = never scanned. `usageFiles` =
  // files read on the last scan (0 → none to compare against). `scanning` gates
  // the toolbar button while a scan is in flight.
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [usageFiles, setUsageFiles] = useState<number>(0);
  const [scanning, setScanning] = useState(false);
  // Latest source language, read inside the (mount-only) message handler so it
  // can tell a source pick from a target pick without re-subscribing.
  const sourceLangRef = useRef("");

  // Persist the per-file layout (chosen target columns + dragged widths). The
  // host's workspaceState is the durable store; vscode.setState is just a local
  // cache for instant hot-restore. Gated on `hydrated` so the first render can't
  // overwrite the saved choice before the host has sent it.
  // Debounce dismissing the loader: keep it up at least MIN_LOADING_MS from when
  // it appeared, so a fast load doesn't flicker it. Re-entering the loading phase
  // (received back to false) resets the dwell clock.
  useEffect(() => {
    if (!received) {
      loadingShownAt.current = Date.now();
      setShowLoading(true);
      return;
    }
    const remaining = MIN_LOADING_MS - (Date.now() - loadingShownAt.current);
    if (remaining <= 0) {
      setShowLoading(false);
      return;
    }
    const t = setTimeout(() => setShowLoading(false), remaining);
    return () => clearTimeout(t);
  }, [received]);

  useEffect(() => {
    if (!hydrated) return;
    vscode.setState({ targets: chosen, widths } satisfies PersistedState);
    post({ type: "setLayout", targets: chosen, widths });
  }, [chosen, widths, hydrated]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const msg = event.data;
      if (msg.type === "init" || msg.type === "update") {
        setText(msg.text);
        setReceived(true);
      } else if (msg.type === "model") {
        setModel(msg.catalog);
        setReceived(true);
      } else if (msg.type === "capabilities") {
        setCaps(msg.capabilities);
      } else if (msg.type === "baseline") {
        setBaselineText(msg.text);
      } else if (msg.type === "baselineModel") {
        setBaselineModel(msg.catalog);
      } else if (msg.type === "settings") {
        setDensity(msg.settings.displayMode);
        setViewMode(msg.settings.mergeKeySource ? "merged" : "split");
        setDoubleClickToEdit(msg.settings.doubleClickToEdit);
      } else if (msg.type === "externalChange") {
        setExternalChange(true);
      } else if (msg.type === "usage") {
        setUsage(msg.counts);
        setUsageFiles(msg.filesScanned);
        setScanning(false);
      } else if (msg.type === "layout") {
        setChosen(msg.targets);
        setWidths(msg.widths);
        setInherited(msg.lastTargets);
        setHydrated(true);
      } else if (msg.type === "selectLanguage") {
        // Sidebar picked one language → focus it. A target shows Key/source +
        // that column; the source has no separate target column, so focusing it
        // means "no targets" → just the (editable) Key/source column.
        setChosen(msg.lang === sourceLangRef.current ? [] : [msg.lang]);
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const catalog = useMemo(() => model ?? parseCatalog(text), [model, text]);
  // Keep the ref current so the message handler (subscribed once) sees the live
  // source language.
  sourceLangRef.current = catalog.sourceLanguage;

  const nonSource = useMemo(
    () => catalog.languages.filter((l) => l !== catalog.sourceLanguage),
    [catalog]
  );

  // Effective targets: chosen → filter to this file. Never chosen (null) → inherit
  // the workspace's last-used set if any of it applies here, else the first language.
  const targets = useMemo(() => {
    if (chosen !== null) return chosen.filter((l) => nonSource.includes(l));
    const inheritedValid = (inherited ?? []).filter((l) => nonSource.includes(l));
    return inheritedValid.length > 0 ? inheritedValid : defaultTargets(catalog);
  }, [chosen, inherited, catalog, nonSource]);

  function updateTargets(next: string[]) {
    setChosen(next);
  }

  // On-demand "find unused keys" (Plan B): ask the host to scan source once. No
  // index / watcher is kept — the user re-runs it when they want fresh data.
  function runScan() {
    if (scanning) return;
    setScanning(true);
    post({ type: "scanUsage", keys: catalog.entries.map((e) => e.key) });
  }
  // Usable results need ≥1 scanned source file; a 0-file scan can't tell
  // "unused" from "nothing to compare against", so we don't flag anything.
  const usageReady = usage !== null && usageFiles > 0;

  // Column resize: live width while dragging, and a reset (back to default) on
  // double-click. Keyed by the column id Grid hands back (KEY_COL_ID / lang).
  function setColWidth(colId: string, px: number) {
    setWidths((prev) => ({ ...prev, [colId]: px }));
  }
  function resetColWidth(colId: string) {
    setWidths((prev) => {
      if (!(colId in prev)) return prev;
      const next = { ...prev };
      delete next[colId];
      return next;
    });
  }

  const keyCount = catalog.entries.length;
  const hasData = keyCount > 0 && !catalog.error;

  const warnCount = useMemo(
    () => (hasData ? countFormatWarnings(catalog, caps.keyAsSource) : 0),
    [catalog, hasData, caps.keyAsSource]
  );
  const progress = useMemo(() => allLanguageProgress(catalog), [catalog]);
  // Search first, then per-filter counts + the active filter share that result
  // so the tab counts equal what each filter would show under the search.
  // Search scope = the visible columns (source + displayed targets) so every
  // match lands in a column that's on screen and gets highlighted.
  const searched = useMemo(
    () =>
      searchEntries(catalog.entries, query, [
        catalog.sourceLanguage,
        ...targets,
      ]),
    [catalog, query, targets]
  );
  // Diff baseline (git HEAD) → which target cells changed since the last commit.
  // .strings ships a prebuilt catalog; .xcstrings ships JSON text we parse here.
  const baseline = useMemo<Baseline | null>(() => {
    if (baselineModel) return buildBaseline(baselineModel);
    if (baselineText !== null) return buildBaseline(parseCatalog(baselineText));
    return null;
  }, [baselineModel, baselineText]);
  // The "Changed" tab needs both a baseline AND a format that supports diffs.
  const diffEnabled = caps.diff && baseline !== null;
  // The "Orphaned" tab only applies to formats where keys can drift from a
  // source file (.strings) and only when a source column actually exists (i.e.
  // editing a target file, not the source file itself).
  const orphanEnabled = caps.orphanKeys && catalog.sourceLanguage !== "";

  // Entry keys with ≥1 changed cell in a displayed target column.
  const changedKeySet = useMemo(() => {
    const set = new Set<string>();
    if (!baseline) return set;
    for (const entry of catalog.entries) {
      for (const row of entry.rows) {
        for (const lang of targets) {
          const base = baselineCell(baseline, entry.key, lang, row.variantKey);
          if (cellChange(base, row.cells[lang]) !== "none") {
            set.add(entry.key);
            break;
          }
        }
        if (set.has(entry.key)) break;
      }
    }
    return set;
  }, [catalog, baseline, targets]);

  const counts = useMemo<Record<UiFilter, number>>(() => {
    const base = filterCounts(searched, catalog.sourceLanguage, targets, caps.keyAsSource);
    const changed = diffEnabled
      ? searched.reduce((n, e) => n + (changedKeySet.has(e.key) ? 1 : 0), 0)
      : 0;
    const unused = usageReady
      ? searched.reduce((n, e) => n + (usage![e.key] === 0 ? 1 : 0), 0)
      : 0;
    return { ...base, changed, unused };
  }, [searched, catalog.sourceLanguage, targets, changedKeySet, diffEnabled, caps.keyAsSource, usage, usageReady]);

  // Conditional tabs disappear when unavailable → fall back to All.
  const effectiveFilter: UiFilter =
    (filter === "changed" && !diffEnabled) ||
    (filter === "orphaned" && !orphanEnabled) ||
    (filter === "unused" && !usageReady)
      ? "all"
      : filter;
  const filters = useMemo(() => {
    const list = [...BASE_FILTERS];
    if (orphanEnabled) list.push({ id: "orphaned", label: "Orphaned" });
    if (usageReady) list.push({ id: "unused", label: "Unused" });
    if (diffEnabled) list.push({ id: "changed", label: "Changed" });
    return list;
  }, [orphanEnabled, diffEnabled, usageReady]);

  const visibleEntries = useMemo(() => {
    if (effectiveFilter === "changed") {
      return searched.filter((e) => changedKeySet.has(e.key));
    }
    if (effectiveFilter === "unused") {
      // Only reachable when usageReady → usage is non-null. A key absent from
      // the scan (added since) is left out, not flagged.
      return searched.filter((e) => usage![e.key] === 0);
    }
    return filterEntries(
      searched,
      catalog.sourceLanguage,
      targets,
      effectiveFilter,
      caps.keyAsSource
    );
  }, [searched, catalog.sourceLanguage, targets, effectiveFilter, changedKeySet, caps.keyAsSource, usage]);

  return (
    <div className={"app" + (density === "compact" ? " density-compact" : "")}>
      <style>{gridStyles}</style>

      {externalChange && (
        <div className="conflict-banner" role="alert">
          <WarningIcon size={16} className="conflict-icon" />
          <span className="conflict-msg">
            This file changed on disk while you have unsaved edits. Saving now
            will overwrite those external changes.
          </span>
          <button
            type="button"
            className="conflict-action primary"
            onClick={() => {
              post({ type: "reload" });
              setExternalChange(false);
            }}
          >
            Reload from disk
          </button>
          <button
            type="button"
            className="conflict-action"
            onClick={() => setExternalChange(false)}
          >
            Keep mine
          </button>
        </div>
      )}

      {hasData && (
        <div className="toolbar">
          <FilterBar
            value={effectiveFilter}
            counts={counts}
            filters={filters}
            onChange={setFilter}
          />
          <span className="spacer" />
          <SearchBox value={query} onChange={setQuery}>
            {caps.chooseColumns && nonSource.length > 0 && (
              <LanguagePicker
                source={catalog.sourceLanguage}
                available={nonSource}
                selected={targets}
                progress={progress}
                onChange={updateTargets}
              />
            )}
          </SearchBox>
          <button
            type="button"
            className={"icon-btn" + (viewMode === "split" ? " active" : "")}
            aria-label="Toggle Key/Source columns"
            aria-pressed={viewMode === "split"}
            title={
              viewMode === "split"
                ? "Key & Source shown separately — click to merge"
                : "Key & Source merged — click to split"
            }
            onClick={() => {
              const next = viewMode === "split" ? "merged" : "split";
              setViewMode(next); // optimistic; the setting echoes back to confirm
              postSetSettings({ mergeKeySource: next === "merged" });
            }}
          >
            <ColumnsIcon size={14} />
          </button>
          <button
            type="button"
            className={"icon-btn" + (density === "compact" ? " active" : "")}
            aria-label="Toggle row density"
            aria-pressed={density === "compact"}
            title={
              density === "compact"
                ? "Compact rows — click for comfortable"
                : "Comfortable rows — click for compact"
            }
            onClick={() => {
              const next = density === "compact" ? "comfortable" : "compact";
              setDensity(next); // optimistic; the setting echoes back to confirm
              postSetSettings({ displayMode: next });
            }}
          >
            <DensityIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Scan code for unused keys"
            title={
              scanning
                ? "Scanning source files…"
                : usage !== null
                ? "Re-scan Swift/Obj-C code for unused keys"
                : "Scan your Swift/Obj-C code to flag keys with no literal reference (Find unused)"
            }
            disabled={scanning}
            onClick={runScan}
          >
            {scanning ? (
              <LoadingIcon size={14} className="spin" />
            ) : (
              <ScanIcon size={14} />
            )}
          </button>
          <CatalogInfo
            sourceLanguage={catalog.sourceLanguage}
            keyCount={keyCount}
            langCount={catalog.languages.length}
            warnCount={warnCount}
          />
        </div>
      )}

      {showLoading ? (
        <div className="loading-state">
          <LoadingIcon size={16} className="spin" />
          <span>Loading catalog…</span>
        </div>
      ) : catalog.error ? (
        <div className="center-state">
          <p className="state-title error">This file isn't valid JSON</p>
          <p className="state-detail">{catalog.error}</p>
          <button className="notice-action" onClick={postOpenAsText}>
            Open as text to fix
          </button>
        </div>
      ) : catalog.notCatalog ? (
        <div className="center-state">
          <p className="state-title">This file isn't a String Catalog</p>
          <p className="state-detail">
            It's valid JSON but has no <code>strings</code> table, so there's
            nothing to edit here.
          </p>
          <button className="notice-action" onClick={postOpenAsText}>
            Open as text
          </button>
        </div>
      ) : keyCount === 0 ? (
        <p className="notice">Empty catalog — no keys yet.</p>
      ) : (
        <Grid
          entries={visibleEntries}
          sourceLanguage={catalog.sourceLanguage}
          targets={targets}
          progress={progress}
          query={query}
          baseline={baseline}
          widths={widths}
          density={density}
          merged={viewMode === "merged"}
          doubleClickToEdit={doubleClickToEdit}
          caps={caps}
          onResize={setColWidth}
          onResetWidth={resetColWidth}
          onSetValue={postSetValue}
          onSetComment={postSetComment}
          onSetShouldTranslate={postSetShouldTranslate}
          onSetState={postSetState}
          onFindInCode={postFindInCode}
          usage={usageReady ? usage : null}
        />
      )}
    </div>
  );
}
