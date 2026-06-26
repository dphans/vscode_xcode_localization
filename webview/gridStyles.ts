// CSS for the grid (div-based CSS Grid, no <table>). Injected via <style> —
// the CSP allows style-src 'unsafe-inline'. Every color is a var(--vscode-*) to
// follow the theme + contrast mode (see the design-tokens memory).
//
// Structure: each .row is its own grid sharing grid-template-columns (the
// --cols variable set on .grid). Columns have FIXED widths so every row lines
// up (independent grid rows would drift if tracks sized to content) — this also
// paves the way for virtualization in M5. The last column uses 1fr to fill the
// gap when the window is wide.

export const gridStyles = /* css */ `
:root {
  --app-radius: 2px;
  --col-key: 260px;
  --col-lang: 300px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }

.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

/* ---- Toolbar (single row): filter tabs · count · search (with language
   chip) · info. ---- */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent));
}
.toolbar .spacer { flex: 1 1 auto; }

/* Info action — a borderless toolbar-style icon button (transparent, lights up
   on hover), not a filled/outlined button. */
.info-menu { position: relative; }
.icon-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  opacity: 0.8;
  border-radius: var(--app-radius);
  cursor: pointer;
}
.icon-btn svg { display: block; }
.icon-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.icon-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.icon-btn svg { display: block; }
/* Toggled-on toolbar button (e.g. compact density active). */
.icon-btn.active {
  opacity: 1;
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.info-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 200px;
  padding: 8px 10px;
  border-radius: var(--app-radius);
  border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, var(--vscode-editorWidget-border)));
  background: var(--vscode-editorWidget-background);
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
}
.info-list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  font-size: 12px;
}
.info-list dt { opacity: 0.7; }
.info-list dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

.muted { opacity: 0.7; }
.small { font-size: 11px; }

/* Filters styled as VSCode panel tabs (like Problems/Output/Terminal): no pill,
   the active one is brighter with an underline indicator. flex-shrink:0 so they
   never get squeezed (and never wrap to 2 lines). */
.filterbar { display: inline-flex; gap: 2px; flex-shrink: 0; }
.filter-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
  font-size: 12px;
  line-height: 16px;
  padding: 3px 8px;
  border: none;
  /* transparent underline on every tab reserves the space so switching the
     active tab never shifts the layout. */
  border-bottom: 1px solid transparent;
  background: transparent;
  color: var(--vscode-panelTitle-inactiveForeground, var(--vscode-descriptionForeground));
  cursor: pointer;
  white-space: nowrap;
}
.filter-tab svg { display: block; }
.filter-tab:hover {
  color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
}
.filter-tab.active {
  color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
  border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder));
}
.filter-tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
/* Per-tab count, de-emphasized and parenthesized (parens via CSS so the tighter
   gap to the label reads as one unit). */
.filter-tab .tab-label { margin-right: -2px; }
.filter-tab .tab-count {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.filter-tab .tab-count::before { content: "("; }
.filter-tab .tab-count::after { content: ")"; }
.filter-tab.active .tab-count { opacity: 0.85; }

/* ---- Search field (VSCode Settings style) ----
   The border wraps the whole field: a leading magnifier, the borderless input,
   then trailing actions (clear, language chip). Compact, not full-width. */
.search {
  display: flex;
  align-items: center;
  flex: 0 1 300px;
  min-width: 200px;
  gap: 4px;
  height: 26px;
  padding: 0 4px 0 8px;
  background: var(--vscode-settings-textInputBackground, var(--vscode-input-background));
  border: 1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, var(--vscode-widget-border, transparent)));
  border-radius: var(--app-radius);
}
.search:focus-within { border-color: var(--vscode-focusBorder); }
.search-icon {
  flex: 0 0 auto;
  display: inline-flex;
  opacity: 0.6;
  pointer-events: none;
}
.search-icon svg { display: block; }
.search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  font-family: inherit;
  font-size: 13px;
  line-height: 24px;
  padding: 0;
  color: var(--vscode-input-foreground);
  background: transparent;
  border: none;
  outline: none;
}
.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
}
/* Hide the native search clear (we render our own close button). */
.search-input::-webkit-search-cancel-button { display: none; }

/* Inline clear button inside the field. */
.search-clear {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  opacity: 0.75;
  cursor: pointer;
  border-radius: var(--app-radius);
}
.search-clear svg { display: block; }
.search-clear:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.search-clear:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* Language chip inside the field (shows current targets, opens the picker) —
   styled like a VSCode Settings filter token. */
.lang-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 3px 0 6px;
  border: none;
  border-radius: var(--app-radius);
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.lang-chip svg { display: block; opacity: 0.8; }
.lang-chip:hover { filter: brightness(1.1); }
.lang-chip.active { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.lang-chip:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* Progress bar (language picker rows) — fixed width so bars line up. */
.prog-bar {
  display: block;
  width: 56px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.3)));
}
.prog-fill {
  display: block;
  height: 100%;
  background: var(--vscode-charts-green, var(--vscode-progressBar-background));
}
.prog-pct {
  text-align: right;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}

/* ---- Target language picker (the funnel inside the search field) ---- */
.lang-picker { position: relative; display: inline-flex; }
.lang-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 300px;
  max-width: 380px;
  max-height: 50vh;
  overflow: auto;
  /* no top padding so the sticky header sits flush at the top */
  padding: 0 4px 4px;
  border-radius: var(--app-radius);
  border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, var(--vscode-editorWidget-border)));
  background: var(--vscode-editorWidget-background);
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
}
/* Sticky so the title + Select all / Clear all stay reachable while scrolling a
   long language list (opaque background so rows scroll cleanly underneath). */
.pop-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 4px;
  margin-bottom: 4px;
  background: var(--vscode-editorWidget-background);
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent));
}
.pop-title { font-size: 11px; font-weight: 600; opacity: 0.85; }
.lang-popover .pop-actions { display: flex; gap: 8px; }
.pop-link {
  font-size: 11px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
}
.pop-link:hover { text-decoration: underline; }
/* Column grid: checkbox · name+code (grows, truncates) · bar (fixed) · percent.
   Fixed bar/percent columns keep them aligned across rows of varying name length. */
.lang-popover label {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: var(--app-radius);
  cursor: pointer;
  font-size: 12px;
}
/* Full name (primary) + code (muted secondary); truncate long names, code kept. */
.lang-name {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.lang-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lang-code {
  flex: 0 0 auto;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 10px;
  opacity: 0.55;
}
.lang-code::before { content: "("; }
.lang-code::after { content: ")"; }
.lang-popover label:hover { background: var(--vscode-list-hoverBackground); }
.lang-popover label.is-source {
  opacity: 0.6;
  cursor: default;
}
.lang-popover label.is-source:hover { background: transparent; }
.lang-popover .src-tag {
  grid-column: 3 / -1;
  justify-self: end;
  font-size: 10px;
  opacity: 0.8;
}

/* ---- Scroll area ---- */
/* overflow-anchor:none — virtualization resizes the top/bottom spacer blocks as
   you scroll; the browser's own scroll anchoring would try to compensate for
   those height changes and fight the windowing math, causing nondeterministic
   jumps. Disable it so the virtualizer is the sole authority on scroll offset. */
.grid-wrap { flex: 1 1 auto; overflow: auto; overflow-anchor: none; }

.grid {
  width: 100%;
  /* min-width is set inline = sum of column floor widths. Using that instead of
     max-content means the grid only grows (→ horizontal scroll) when the FIXED
     columns can't fit, so the flexible last column wraps within the pane rather
     than stretching the whole grid to fit its longest line on one row. */
}
.row {
  display: grid;
  grid-template-columns: var(--cols);
}
.cell {
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent));
  border-right: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent));
  overflow: hidden;
}
/* ---- Column resize handle (header right edge) ----
   A thin grab strip overlaying each header cell's right border. The cell is
   already a positioning context (head-cell is relative; key/source are sticky),
   so the handle anchors to its right edge. */
.col-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  z-index: 6;
  cursor: col-resize;
  /* stop the browser from treating the drag as a pan/scroll gesture */
  touch-action: none;
}
.col-resize::after {
  content: "";
  position: absolute;
  top: 3px;
  bottom: 3px;
  right: 0;
  width: 2px;
  background: transparent;
}
.col-resize:hover::after,
.col-resize:active::after { background: var(--vscode-focusBorder); }

/* Sticky header.
   keybindingTable-headerBackground is often SEMI-TRANSPARENT (alpha) → when
   sticky, scrolled content shows through. Stack two layers: an opaque
   editor-background base + the header tint on top (via linear-gradient) ⇒
   always 100% opaque while keeping the header tint. */
.row.head { position: sticky; top: 0; z-index: 3; }
.row.head .cell {
  font-weight: 600;
  white-space: nowrap;
  background-color: var(--vscode-editor-background);
  background-image: linear-gradient(
    var(--vscode-keybindingTable-headerBackground, var(--vscode-editorGroupHeader-tabsBackground, transparent)),
    var(--vscode-keybindingTable-headerBackground, var(--vscode-editorGroupHeader-tabsBackground, transparent))
  );
}
/* "source" is a static annotation, NOT a control — render it as quiet muted
   text (no fill/border) so it doesn't read as a clickable chip like the
   language chip in the search bar. */
.lang-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  opacity: 0.7;
}

/* Per-column translation progress, drawn as a colored underline along the
   header's bottom edge. The cell's gray bottom border is the track; the green
   fill covers the % completed (absolute → adds no height to the header). */
.head-cell { position: relative; }
.head-top { display: flex; align-items: center; gap: 6px; }
/* Name (primary) + code inline as "English (en)": the name truncates if it
   outgrows the column, but the code is always kept (the file + devs use codes). */
.head-lang {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.head-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lang-tag { flex: 0 0 auto; }
.head-pct {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
.head-code {
  flex: 0 0 auto;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 10px;
  font-weight: 400;
  opacity: 0.55;
}
.head-code::before { content: "("; }
.head-code::after { content: ")"; }
.head-prog {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  overflow: hidden;
}
.head-prog-fill {
  height: 100%;
  background: var(--vscode-charts-green, var(--vscode-progressBar-background));
}

/* Sticky Key column (frozen pane, uniform background) */
.cell.key {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--vscode-editor-background);
}
.row.head .cell.key { z-index: 4; }

/* Zebra + hover. Zebra uses an explicit .row-zebra class (set from the row's
   true index) instead of :nth-child — virtualization inserts spacer blocks, so
   DOM position no longer matches the row's real parity. The key column keeps
   its own background so it stays opaque. */
.grid-body .row.row-zebra .cell {
  background: var(--vscode-tree-tableOddRowsBackground, transparent);
}
.grid-body .row.row-zebra .cell.key { background: var(--vscode-editor-background); }
.grid-body .row:hover .cell { background: var(--vscode-list-hoverBackground); }
/* Sticky Key column: list-hoverBackground is semi-transparent → scrolled
   content would show through when scrolling horizontally. Layer the hover tint
   over the opaque editor-background ⇒ stays opaque while looking exactly like
   the hover color of the other cells (which is also a tint over the base). */
.grid-body .row:hover .cell.key {
  background-color: var(--vscode-editor-background);
  background-image: linear-gradient(
    var(--vscode-list-hoverBackground),
    var(--vscode-list-hoverBackground)
  );
}

/* Sticky source column: frozen right after Key (offset by the key width) so it
   stays visible when scrolling through many target columns. Same opaque-layer
   trick as the Key column for zebra/hover. */
.cell.col-source {
  position: sticky;
  left: var(--col-key);
  z-index: 1;
  background: var(--vscode-editor-background);
  /* Mark the frozen boundary: target columns scroll UNDER here. A visible
     border carries the line in every theme (a shadow alone is invisible on
     dark backgrounds); the shadow adds depth where the theme defines one. */
  border-right: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-contrastBorder, transparent))));
  box-shadow: 6px 0 6px -4px var(--vscode-scrollbar-shadow, transparent);
}
.row.head .cell.col-source { z-index: 4; }
.grid-body .row.row-zebra .cell.col-source { background: var(--vscode-editor-background); }
.grid-body .row:hover .cell.col-source {
  background-color: var(--vscode-editor-background);
  background-image: linear-gradient(
    var(--vscode-list-hoverBackground),
    var(--vscode-list-hoverBackground)
  );
}

/* ---- Merged Key+Source column (merged view) ----
   The frozen first column (sticky at left:0 via .cell.key) here also marks the
   frozen boundary that target columns scroll under — so it carries the same
   right border + shadow as the source column does in split view. */
.cell.ref-col {
  border-right: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-contrastBorder, transparent))));
  box-shadow: 6px 0 6px -4px var(--vscode-scrollbar-shadow, transparent);
}
/* Primary line = the source string; it grows beside the kebab. */
.key-head .ref-source { flex: 1 1 auto; min-width: 0; }
/* Secondary line = the key, shown only when it differs from the source. Muted
   mono so it reads as a developer-facing identifier, not prose. */
.ref-key {
  margin-top: 3px;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  opacity: 0.6;
  word-break: break-word;
}
.row-excluded .ref-key { opacity: 0.5; }

/* Key cell content */
.key-name {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  word-break: break-word;
}
.key-comment { margin-top: 3px; font-size: 11px; opacity: 0.7; word-break: break-word; }
.key-flags { margin-top: 4px; }
.flag {
  font-size: 10px;
  padding: 0 5px;
  border-radius: var(--app-radius);
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  opacity: 0.85;
}
.flag-muted {
  background: transparent;
  color: var(--vscode-descriptionForeground, var(--vscode-disabledForeground));
  box-shadow: inset 0 0 0 1px var(--vscode-widget-border, var(--vscode-contrastBorder, var(--vscode-disabledForeground)));
  opacity: 1;
}
.flag-orphan {
  background: transparent;
  color: var(--vscode-list-warningForeground, var(--vscode-editorWarning-foreground));
  box-shadow: inset 0 0 0 1px var(--vscode-editorWarning-foreground);
  opacity: 1;
}
/* "unused" (no code reference found) — neutral outline, not a warning colour:
   it's an advisory hint to verify, distinct from the orphan flag. */
.flag-unused {
  background: transparent;
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  box-shadow: inset 0 0 0 1px var(--vscode-descriptionForeground, var(--vscode-contrastBorder, var(--vscode-disabledForeground)));
  opacity: 1;
}
/* Keys marked shouldTranslate:false → dim the value/key text (avoid opacity on
   the row itself, which would create a stacking context and break sticky). */
.row-excluded .cell-value,
.row-excluded .key-name { opacity: 0.5; }
.variant-label {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  opacity: 0.85;
}
.variant-label svg { flex: 0 0 auto; }

/* ---- Plural / device grouping ----
   A plural/device key renders as a header row (the key) + one indented variant
   sub-row per form. Group cohesion comes from three things:
   1) the divider is drawn only on the LAST row of a key (others go transparent),
   2) zebra shades per ENTRY (all of a key's rows share one tint), and
   3) variant rows are indented under a tree-style guide bar. */
.grid-body .row.group-mid .cell { border-bottom-color: transparent; }

/* Header row: the key sits alone; its value columns are empty. */
.row-keyheader .cell.key { padding-bottom: 4px; }

/* Variant sub-row: indent the form label and draw the guide bar. The key cell
   is position:sticky (a positioned ancestor) so ::before anchors to it; stacked
   variant rows align their bars into one continuous line. */
.cell.key.key-variant { padding-left: 28px; }
.cell.key.key-variant::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--vscode-tree-indentGuidesStroke, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
}
.key-variant .variant-label { margin-top: 0; opacity: 0.8; }

/* Language value cell */
.cell-value { white-space: pre-wrap; word-break: break-word; font-size: 12px; }
/* Format specifiers (%@, %lld, %1$@…) highlighted like inline code so
   translators can see what must be preserved. */
.spec {
  font-family: var(--vscode-editor-font-family, monospace);
  font-style: normal;
  color: var(--vscode-textPreformat-foreground, var(--vscode-charts-orange));
  background: var(--vscode-textPreformat-background, rgba(128, 128, 128, 0.18));
  border-radius: var(--app-radius);
  padding: 0 2px;
}
/* Search match highlight (key names, comments, value text). */
.hl {
  background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
  color: inherit;
  border-radius: 2px;
}
.cell-empty { font-style: italic; opacity: 0.6; }
.cell-missing { opacity: 0.4; }
.cell-foot { margin-top: 4px; }
/* Source localization missing → show the key as the implicit source value */
.cell-source-fallback { opacity: 0.75; font-style: italic; }

/* Editable target cell */
.cell-editable { cursor: text; }
.grid-body .row .cell-editable:hover {
  box-shadow: inset 0 0 0 1px var(--vscode-input-border, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
}
.cell-editing { padding: 3px; }
.cell-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font-family: var(--vscode-font-family);
  font-size: 12px;
  line-height: 1.4;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-focusBorder);
  border-radius: var(--app-radius);
  padding: 4px 6px;
  margin: 0;
  resize: none;
  overflow: hidden;
  outline: none;
}

/* Format-specifier warning */
.cell-warn {
  margin-top: 4px;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-editorWarning-foreground);
  word-break: break-word;
}
/* Icon stays put on the first line; the text may wrap below it. */
.cell-warn svg { flex: 0 0 auto; margin-top: 1px; }
.cell-warn span { min-width: 0; }
.cell-warn-box {
  box-shadow: inset 2px 0 0 var(--vscode-editorWarning-foreground);
  background: var(--vscode-inputValidation-warningBackground, transparent);
}
/* Keep the warning accent on hover/zebra (background changes but the left bar stays) */
.grid-body .row:hover .cell-warn-box,
.grid-body .row.row-zebra .cell-warn-box {
  box-shadow: inset 2px 0 0 var(--vscode-editorWarning-foreground);
}

/* State badge — a soft status chip: the STATE color drives the text, the dot
   and a faint same-hue tint behind them. (The old filled badge put yellow
   warning text on the solid blue badge-background → poor contrast.) The text is
   the state's own foreground color, which the theme designs to read on the
   editor background, so contrast holds in every theme.
   color-mix gives the tint; a transparent fallback precedes it so themes on an
   engine without color-mix still get readable text + dot (just no fill). */
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 15px;
  padding: 0 6px;
  border-radius: var(--app-radius);
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  background: transparent;
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.badge::before {
  content: "";
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  background: currentColor;
}
.badge-translated { color: var(--vscode-charts-green, var(--vscode-testing-iconPassed)); }
.badge-needs_review { color: var(--vscode-editorWarning-foreground); }
.badge-new { color: var(--vscode-descriptionForeground, var(--vscode-foreground)); }
.badge-stale { color: var(--vscode-disabledForeground); }

/* ---- Changed-since-commit marker (git HEAD diff) ----
   A 2px left bar in the editor's own gutter colors (modified/added), drawn as a
   pseudo-element so it sits ABOVE the format-warning inset bar and survives
   zebra/hover. Only ever applied to target cells (never the sticky source/key
   columns), so position:relative is safe here. */
.cell-changed, .cell-added { position: relative; }
.cell-changed::after, .cell-added::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  pointer-events: none;
}
.cell-changed::after {
  background: var(--vscode-editorGutter-modifiedBackground, var(--vscode-charts-blue));
}
.cell-added::after {
  background: var(--vscode-editorGutter-addedBackground, var(--vscode-charts-green));
}

/* ---- Keyboard cursor (active cell) ----
   The active cell is the keyboard-navigation target (arrows move it, Enter
   edits). The ring only shows while the grid actually holds focus
   (:focus-within) — like a VSCode list, a cursor left behind isn't distracting
   when you're working elsewhere. We draw it with outline (not box-shadow) so it
   stacks cleanly over the warning bar and the change markers. The container's
   own focus ring is suppressed: the active-cell ring is the focus indicator. */
.grid-wrap { outline: none; }
.grid-wrap:focus-within .cell.cell-active {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
/* The merged Key+Source column's source line isn't a full .cell, so it gets its
   own (slightly offset) ring when it's the keyboard cursor. */
.grid-wrap:focus-within .ref-source.cell-active {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
  border-radius: 2px;
}
/* Editable folded source line (merged view): a text caret + a faint hover frame
   so it reads as editable, matching the value cells' hover affordance. */
.ref-source-editable { cursor: text; border-radius: var(--app-radius); }
.grid-body .row .ref-source-editable:hover {
  box-shadow: inset 0 0 0 1px var(--vscode-input-border, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
}
/* The inline source editor grows to fill the column (beside the kebab on the
   single-key row; full width on a variant row). */
.ref-input { flex: 1 1 auto; min-width: 0; }

/* ---- Row / cell action affordances ---- */
/* Key header: name grows, kebab sits at the trailing edge. The kebab keeps its
   slot (opacity, not display) so revealing it on hover never shifts the name. */
.key-head { display: flex; align-items: flex-start; gap: 6px; }
.key-head .key-name { flex: 1 1 auto; min-width: 0; }
.key-comment.editable { cursor: text; }
.key-comment.editable:hover {
  opacity: 0.95;
  text-decoration: underline;
  text-decoration-style: dotted;
}

/* Kebab triggers (key header + target cells), revealed on row hover. */
.row-kebab, .cell-kebab {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  border-radius: var(--app-radius);
  cursor: pointer;
  opacity: 0;
}
.row-kebab { flex: 0 0 auto; }
.row-kebab svg, .cell-kebab svg { display: block; }
/* Anchor the cell kebab top-right; the cell is positioned via .cell-has-menu.
   z-index:0 makes the cell its OWN stacking context so the kebab's z-index is
   local to the cell — otherwise the kebab (z-index 2) competes directly with
   the sticky Key/source columns (z-index 1) and bleeds OVER them when a target
   cell scrolls underneath while scrolling horizontally. With the context, the
   whole cell (incl. kebab) sits below the frozen columns. */
.cell-has-menu { position: relative; z-index: 0; }
.cell-kebab { position: absolute; top: 2px; right: 2px; z-index: 2; }
.grid-body .row:hover .row-kebab,
.grid-body .row:hover .cell-kebab { opacity: 0.55; }
.row-kebab:hover, .cell-kebab:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.row-kebab:focus-visible, .cell-kebab:focus-visible {
  opacity: 1;
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

/* Inline note editor (same look as the cell editor, comment-sized). */
.note-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 3px;
  font-family: var(--vscode-font-family);
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-focusBorder);
  border-radius: var(--app-radius);
  padding: 3px 5px;
  resize: none;
  overflow: hidden;
  outline: none;
}
.note-input::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
}

/* ---- Floating menu (kebab dropdowns + right-click context menus) ---- */
.ctx-menu {
  position: fixed;
  z-index: 50;
  min-width: 200px;
  padding: 4px;
  border-radius: var(--app-radius);
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)));
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground, var(--vscode-foreground)));
  box-shadow: 0 2px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  font-size: 13px;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  border-radius: var(--app-radius);
  cursor: pointer;
}
.ctx-item:hover:not(:disabled) {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
}
.ctx-item:disabled { opacity: 0.4; cursor: default; }
.ctx-item:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.ctx-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ctx-icon svg { display: block; }
.ctx-label { flex: 1 1 auto; white-space: nowrap; }
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(128, 128, 128, 0.3)));
}

/* ---- Consolidated toolbar "⋯" menu ----
   Folds the view/density toggles + the scan action + catalog stats into one
   dropdown so the toolbar stays uncluttered. Styled like the floating .ctx-menu
   but anchored under its button (absolute, not fixed) via the .info-menu
   wrapper. Reuses .ctx-item rows and the .info-list stats grid. */
.toolbar-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 220px;
  padding: 4px;
  border-radius: var(--app-radius);
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)));
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground, var(--vscode-foreground)));
  box-shadow: 0 2px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  font-size: 13px;
}
/* Read-only stats footer inside the menu (quieter than the menu rows). */
.menu-info { padding: 2px 8px; }
.menu-info .info-list { font-size: 11px; opacity: 0.85; }

/* ---- Loading state ---- */
/* Shown until the host delivers the file text (heavy files take a moment to
   arrive + parse) so a loading catalog never reads as an empty one. */
.loading-state {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  font-size: 13px;
}
.loading-state .spin {
  color: var(--vscode-progressBar-background, var(--vscode-foreground));
  animation: xi-spin 1s linear infinite;
}
@keyframes xi-spin { to { transform: rotate(360deg); } }

/* ---- Empty / error / not-a-catalog states ---- */
.notice { padding: 16px; }
.notice.error { color: var(--vscode-errorForeground); }
.grid-empty { padding: 16px; opacity: 0.7; font-size: 12px; }

/* Centered failure screen (broken JSON / wrong file) with an escape-hatch
   button to open the raw file as text. */
.center-state {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}
.center-state .state-title { margin: 0; font-size: 14px; font-weight: 600; }
.center-state .state-title.error { color: var(--vscode-errorForeground); }
.center-state .state-detail {
  margin: 0;
  max-width: 60ch;
  font-size: 12px;
  opacity: 0.8;
  word-break: break-word;
}
.center-state .state-detail code {
  font-family: var(--vscode-editor-font-family, monospace);
  background: var(--vscode-textPreformat-background, rgba(128, 128, 128, 0.18));
  color: var(--vscode-textPreformat-foreground, inherit);
  border-radius: var(--app-radius);
  padding: 0 3px;
}
.notice-action {
  margin-top: 6px;
  padding: 4px 14px;
  font-family: inherit;
  font-size: 13px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: var(--app-radius);
  cursor: pointer;
}
.notice-action:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.notice-action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* ---- External-change conflict banner ----
   A full-width strip pinned above the toolbar when the file was rewritten on
   disk while the document is dirty. Uses VSCode's input-validation warning
   palette so it reads as a warning in every theme. */
.conflict-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWarning-background));
  border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
}
.conflict-banner .conflict-icon {
  flex: 0 0 auto;
  color: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningForeground));
}
.conflict-banner .conflict-msg { flex: 1 1 auto; }
.conflict-action {
  flex: 0 0 auto;
  padding: 2px 10px;
  font-family: inherit;
  font-size: 12px;
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-widget-border, transparent)));
  border-radius: var(--app-radius);
  cursor: pointer;
}
.conflict-action.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-border, transparent);
}
.conflict-action:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.conflict-action.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.conflict-action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* ---- Compact density ----
   Trims the VERTICAL rhythm only (cell padding + the gaps before secondary
   bits) so more rows fit; font sizes stay put for legibility. Toggled via the
   .density-compact class on .app. */
.app.density-compact .cell { padding: 2px 10px; }
.app.density-compact .cell-editing { padding: 1px; }
.app.density-compact .key-comment,
.app.density-compact .variant-label { margin-top: 1px; }
.app.density-compact .key-flags,
.app.density-compact .cell-foot,
.app.density-compact .cell-warn { margin-top: 2px; }
`;
