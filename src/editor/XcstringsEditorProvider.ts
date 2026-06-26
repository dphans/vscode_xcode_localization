import * as vscode from "vscode";
import type {
  HostToWebview,
  WebviewToHost,
  Settings,
  Capabilities,
} from "../shared/protocol";
import type { EditResult } from "../shared/edit";
import {
  setTranslation,
  setComment,
  setShouldTranslate,
  setState,
} from "../shared/edit";
import { setStringValue, setStringComment } from "./editStrings";
import { resolveLprojGroup, detectSourceLanguage, type LprojGroup } from "./lproj";
import { buildStringsCatalog } from "./stringsModel";
import { getRepository, getHeadText } from "./git";

/**
 * Custom Text Editor for `*.xcstrings` (String Catalog) and `*.strings` (legacy,
 * one file per language) files.
 *
 * The editor is backed by the real TextDocument, so save / dirty / undo-redo /
 * git diff come for free. Principle: the webview NEVER writes the file itself —
 * every change is sent here as a message and applied via a WorkspaceEdit to the
 * ACTIVE document only.
 *
 * `.xcstrings`: the webview parses the JSON text itself and edits land via
 * `edit.ts`. `.strings`: the host parses + aggregates the opened file with its
 * source-language sibling into a `Catalog` it ships to the webview, and edits
 * land via `editStrings.ts` on the opened file.
 */
export class XcstringsEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly xcstringsViewType = "xcodeI18n.xcstringsEditor";
  public static readonly stringsViewType = "xcodeI18n.stringsEditor";

  /** Register both custom editors and return the provider so commands (e.g. the
   * sidebar's "open this language") can drive open editors. Disposables are
   * pushed onto the extension context. */
  public static register(
    context: vscode.ExtensionContext
  ): XcstringsEditorProvider {
    const provider = new XcstringsEditorProvider(context);
    const opts = {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    };
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(
        XcstringsEditorProvider.xcstringsViewType,
        provider,
        opts
      ),
      vscode.window.registerCustomEditorProvider(
        XcstringsEditorProvider.stringsViewType,
        provider,
        opts
      )
    );
    return provider;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Live editors by document URI → their post() fn, so a command can message an
   * already-open editor. Populated in resolve, cleared on panel dispose. */
  private readonly panels = new Map<string, (msg: HostToWebview) => void>();
  /** A language picked from the tree before its editor finished opening; flushed
   * to the webview once it reports "ready". Keyed by document URI. */
  private readonly pendingSelection = new Map<string, string>();

  /**
   * Open `uri` in the catalog grid focused on a single language: only Key/source
   * + that column. Drives an already-open editor immediately; otherwise stashes
   * the choice so the editor applies it as soon as it's ready. The caller is
   * responsible for the actual `vscode.openWith`.
   */
  public selectCatalogLanguage(uri: vscode.Uri, lang: string): void {
    const key = uri.toString();
    const post = this.panels.get(key);
    if (post) {
      post({ type: "selectLanguage", lang });
    } else {
      this.pendingSelection.set(key, lang);
    }
  }

  /** Read the `xcodeI18n.*` display settings (source of truth for the webview's
   * density + merged-column view). */
  private readSettings(): Settings {
    const c = vscode.workspace.getConfiguration("xcodeI18n");
    return {
      displayMode:
        c.get<string>("displayMode") === "compact" ? "compact" : "comfortable",
      mergeKeySource: c.get<boolean>("mergeKeySource") ?? true,
      doubleClickToEdit: c.get<boolean>("doubleClickToEdit") ?? true,
    };
  }

  /** Persist a display-option change posted from a toolbar toggle. */
  private applySettings(settings: Partial<Settings>): void {
    const c = vscode.workspace.getConfiguration("xcodeI18n");
    if (settings.displayMode !== undefined) {
      void c.update("displayMode", settings.displayMode, vscode.ConfigurationTarget.Global);
    }
    if (settings.mergeKeySource !== undefined) {
      void c.update("mergeKeySource", settings.mergeKeySource, vscode.ConfigurationTarget.Global);
    }
    if (settings.doubleClickToEdit !== undefined) {
      void c.update("doubleClickToEdit", settings.doubleClickToEdit, vscode.ConfigurationTarget.Global);
    }
  }

  /** Fetch the file's HEAD content and push it as the diff baseline. */
  private pushBaseline(
    uri: vscode.Uri,
    post: (msg: HostToWebview) => void
  ): void {
    void getHeadText(uri).then((text) => post({ type: "baseline", text }));
  }

  // ---- Per-file layout, persisted in workspaceState (never written to the
  // project tree). Keyed by the file's workspace-relative path so it's stable
  // across machines; files outside any folder fall back to their full path. ----

  private layoutKey(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
  }

  private readLayoutStore(): LayoutStore {
    return (
      this.context.workspaceState.get<LayoutStore>(LAYOUT_KEY) ?? {
        files: {},
        lastTargets: null,
      }
    );
  }

  /** Send the saved layout for this file plus the workspace's last-used column
   * set (so a never-opened file inherits it rather than the first language). */
  private pushLayout(
    uri: vscode.Uri,
    post: (msg: HostToWebview) => void
  ): void {
    const store = this.readLayoutStore();
    const rec = store.files[this.layoutKey(uri)];
    post({
      type: "layout",
      targets: rec?.targets ?? null,
      widths: rec?.widths ?? {},
      lastTargets: store.lastTargets,
    });
  }

  /** Persist a file's chosen columns + widths. A non-empty explicit target set
   * also becomes the workspace's `lastTargets` for new-file inheritance. */
  private async saveFileLayout(
    uri: vscode.Uri,
    targets: string[] | null,
    widths: Record<string, number>
  ): Promise<void> {
    const store = this.readLayoutStore();
    store.files[this.layoutKey(uri)] = { targets, widths };
    if (targets && targets.length > 0) {
      store.lastTargets = targets;
    }
    await this.context.workspaceState.update(LAYOUT_KEY, store);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    const post = (msg: HostToWebview) => webviewPanel.webview.postMessage(msg);
    const isStrings = !document.uri.path.endsWith(".xcstrings");

    // Track this live editor so commands can message it (e.g. focus a language
    // picked in the sidebar). Guard the delete so a re-resolve can't evict the
    // current panel's entry.
    const docKey = document.uri.toString();
    this.panels.set(docKey, post);
    webviewPanel.onDidDispose(() => {
      if (this.panels.get(docKey) === post) this.panels.delete(docKey);
    });

    if (isStrings) {
      await this.resolveStrings(document, webviewPanel, post);
    } else {
      this.resolveXcstrings(document, webviewPanel, post);
    }

    // Settings changes apply to either format.
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("xcodeI18n.displayMode") ||
        e.affectsConfiguration("xcodeI18n.mergeKeySource") ||
        e.affectsConfiguration("xcodeI18n.doubleClickToEdit")
      ) {
        post({ type: "settings", settings: this.readSettings() });
      }
    });
    webviewPanel.onDidDispose(() => cfgSub.dispose());
  }

  // ---- .xcstrings (unchanged behaviour: webview parses the JSON text) ----
  private resolveXcstrings(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    post: (msg: HostToWebview) => void
  ): void {
    const caps: Capabilities = {
      reviewState: true,
      shouldTranslate: true,
      editComment: true,
      diff: true,
      chooseColumns: true,
      orphanKeys: false,
      keyAsSource: true,
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        post({ type: "update", text: document.getText() });
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    const watchSub = this.watchExternalEdits(document, post);
    webviewPanel.onDidDispose(() => watchSub.dispose());

    void getRepository(document.uri).then((repo) => {
      if (repo) {
        const sub = repo.state.onDidChange(() =>
          this.pushBaseline(document.uri, post)
        );
        webviewPanel.onDidDispose(() => sub.dispose());
        this.pushBaseline(document.uri, post);
      }
    });

    webviewPanel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (this.handleCommon(msg, document, webviewPanel)) return;
      if (msg.type === "ready") {
        post({ type: "settings", settings: this.readSettings() });
        post({ type: "capabilities", capabilities: caps });
        this.pushLayout(document.uri, post);
        // After layout, so a language picked from the tree wins over the
        // restored columns.
        const pending = this.pendingSelection.get(document.uri.toString());
        if (pending !== undefined) {
          this.pendingSelection.delete(document.uri.toString());
          post({ type: "selectLanguage", lang: pending });
        }
        post({ type: "init", text: document.getText() });
        this.pushBaseline(document.uri, post);
        return;
      }
      const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      const text = document.getText();
      let result: EditResult | undefined;
      let label = "";
      switch (msg.type) {
        case "setValue":
          result = setTranslation(text, msg.key, msg.lang, msg.segments, msg.value, { eol });
          label = `${msg.key}/${msg.lang}`;
          break;
        case "setComment":
          result = setComment(text, msg.key, msg.comment, { eol });
          label = `${msg.key} (comment)`;
          break;
        case "setShouldTranslate":
          result = setShouldTranslate(text, msg.key, msg.value, { eol });
          label = `${msg.key} (shouldTranslate)`;
          break;
        case "setState":
          result = setState(text, msg.key, msg.lang, msg.segments, msg.state, { eol });
          label = `${msg.key}/${msg.lang} (state)`;
          break;
      }
      if (result) void this.applyEdits(document, result, label);
    });
  }

  // ---- .strings (host aggregates the opened file + its source sibling) ----
  private async resolveStrings(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    post: (msg: HostToWebview) => void
  ): Promise<void> {
    const group = await resolveLprojGroup(document.uri);
    const sourceLang = group ? await detectSourceLanguage(group) : "";
    const activeLang =
      group?.files.find((f) => f.uri.toString() === document.uri.toString())?.lang ?? "und";
    const sourceUri =
      group && sourceLang && sourceLang !== activeLang
        ? group.files.find((f) => f.lang === sourceLang)?.uri
        : undefined;
    const fallback: LprojGroup =
      group ?? { groupDir: document.uri, basename: "", files: [{ lang: activeLang, uri: document.uri }] };

    const caps: Capabilities = {
      reviewState: false,
      shouldTranslate: false,
      // Comments live in the file being edited only when there's no separate
      // read-only source sibling — i.e. the active file IS the source (or a loose
      // file). Editing a target file shows the source's comments read-only, since
      // we only ever write the active document.
      editComment: sourceUri === undefined,
      diff: true,
      chooseColumns: false,
      orphanKeys: true,
      keyAsSource: false,
    };

    const pushModel = async () => {
      const catalog = await buildStringsCatalog(
        document.getText(),
        activeLang,
        fallback,
        sourceLang
      );
      post({ type: "model", catalog });
    };

    // Build the diff baseline from the active file at git HEAD. Only the active
    // (editable) column is diffed, so we skip the source sibling (sourceLang="")
    // — the read-only source column is never compared. null HEAD → no baseline.
    const pushBaseline = async () => {
      const head = await getHeadText(document.uri);
      if (head === null) {
        post({ type: "baselineModel", catalog: null });
        return;
      }
      const catalog = await buildStringsCatalog(head, activeLang, fallback, "");
      post({ type: "baselineModel", catalog });
    };

    // Rebuild on changes to the active doc OR the source sibling (so the
    // read-only source column stays fresh while you edit either).
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      const uri = e.document.uri.toString();
      if (uri === document.uri.toString() || uri === sourceUri?.toString()) {
        void pushModel();
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    // Conflict guard tracks the active (editable) document only — the read-only
    // source sibling can't be clobbered by a save here.
    const watchSub = this.watchExternalEdits(document, post);
    webviewPanel.onDidDispose(() => watchSub.dispose());

    // Re-push the baseline whenever HEAD moves (commit, checkout, stage).
    void getRepository(document.uri).then((repo) => {
      if (repo) {
        const sub = repo.state.onDidChange(() => void pushBaseline());
        webviewPanel.onDidDispose(() => sub.dispose());
        void pushBaseline();
      }
    });

    webviewPanel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (this.handleCommon(msg, document, webviewPanel)) return;
      if (msg.type === "ready") {
        post({ type: "settings", settings: this.readSettings() });
        post({ type: "capabilities", capabilities: caps });
        this.pushLayout(document.uri, post);
        void pushModel();
        void pushBaseline();
        return;
      }
      const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      if (msg.type === "setValue") {
        // The source column is read-only, so edits always target the active
        // language; guard defensively all the same.
        if (msg.lang !== activeLang) return;
        const result = setStringValue(document.getText(), msg.key, msg.value, { eol });
        void this.applyEdits(document, result, `${msg.key}/${msg.lang}`);
        return;
      }
      if (msg.type === "setComment") {
        // Only when this file owns its comments (no read-only source sibling).
        if (!caps.editComment) return;
        const result = setStringComment(document.getText(), msg.key, msg.comment, { eol });
        void this.applyEdits(document, result, `${msg.key} (comment)`);
        return;
      }
      // setShouldTranslate / setState don't apply to .strings.
    });
  }

  /** Messages handled the same way for both formats. Returns true if consumed. */
  private handleCommon(
    msg: WebviewToHost,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): boolean {
    if (msg.type === "setSettings") {
      this.applySettings(msg.settings);
      return true;
    }
    if (msg.type === "openAsText") {
      void vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
      return true;
    }
    if (msg.type === "findInCode") {
      // Open VSCode's native search, scoped to source files and pre-filled with
      // the key as a quoted literal so it matches Text("Save") / Button("Save") /
      // NSLocalizedString("Save", …) call sites rather than every loose word.
      // Case-sensitive: localization keys are, and the code literal must match
      // the key exactly. The host only drives the search — it never reads code.
      void vscode.commands.executeCommand("workbench.action.findInFiles", {
        query: `"${msg.key}"`,
        filesToInclude: "*.swift, *.m, *.mm",
        triggerSearch: true,
        isRegex: false,
        isCaseSensitive: true,
        matchWholeWord: false,
      });
      return true;
    }
    if (msg.type === "scanUsage") {
      void this.scanUsage(msg.keys).then((res) => {
        webviewPanel.webview.postMessage(res);
        if (res.filesScanned === 0) {
          void vscode.window.showWarningMessage(
            "Xcode Localization: found no Swift/Objective-C source files in the workspace to scan for key usage."
          );
        }
      });
      return true;
    }
    if (msg.type === "setLayout") {
      void this.saveFileLayout(document.uri, msg.targets, msg.widths);
      return true;
    }
    if (msg.type === "reload") {
      // Discard the dirty in-memory copy and reload from disk. `revert` acts on
      // the active editor, so focus this panel first to make it the target; the
      // reload then fires onDidChangeTextDocument → the webview repaints itself.
      void (async () => {
        webviewPanel.reveal(webviewPanel.viewColumn);
        await vscode.commands.executeCommand("workbench.action.files.revert");
      })();
      return true;
    }
    return false;
  }

  /**
   * Plan B "Find unused keys": read every Swift / Obj-C source file in the
   * workspace ONCE and count how often each catalog key appears as a quoted
   * string literal. No index is kept and no watcher is installed — this runs
   * only when the user asks. Counting only the keys we were handed (a Set
   * lookup) keeps it O(matches) work and O(keys) memory regardless of codebase
   * size.
   *
   * Counting plain `"literal"` matches errs toward "used" (comments and
   * unrelated literals inflate counts), so a 0 count is a strong-but-not-certain
   * signal: keys built by interpolation or referenced from storyboards won't be
   * found. The webview surfaces that caveat; nothing is ever auto-deleted.
   */
  private async scanUsage(
    keys: string[]
  ): Promise<{
    type: "usage";
    counts: Record<string, number>;
    filesScanned: number;
  }> {
    const files = await vscode.workspace.findFiles(
      "**/*.{swift,m,mm}",
      CODE_EXCLUDE_GLOB
    );
    const wanted = new Set(keys);
    const counts: Record<string, number> = {};
    for (const k of keys) counts[k] = 0;
    // Standard double-quoted literals, tolerating \" escapes. Obj-C @"…" is
    // covered too (the @ sits outside the quotes). Raw (#"…"#) and multiline
    // ("""…""") strings are out of scope for this first pass.
    const literal = /"((?:[^"\\]|\\.)*)"/g;
    for (const file of files) {
      let text: string;
      try {
        text = Buffer.from(
          await vscode.workspace.fs.readFile(file)
        ).toString("utf8");
      } catch {
        continue;
      }
      literal.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = literal.exec(text)) !== null) {
        const inner = m[1];
        if (wanted.has(inner)) counts[inner]++;
      }
    }
    return { type: "usage", counts, filesScanned: files.length };
  }

  /**
   * Warn the webview when the file is rewritten on disk while the document has
   * unsaved edits — VSCode silently keeps the dirty in-memory copy in that case,
   * so without this the user could Save and clobber an external agent's changes.
   *
   * A clean document is auto-reloaded by VSCode (→ onDidChangeTextDocument →
   * webview update), so we only fire while `isDirty`. Our own saves also touch
   * the file; those land with `isDirty === false` and within the post-save
   * settling window, so they're ignored.
   */
  private watchExternalEdits(
    document: vscode.TextDocument,
    post: (msg: HostToWebview) => void
  ): vscode.Disposable {
    const dir = vscode.Uri.joinPath(document.uri, "..");
    const name = document.uri.path.split("/").pop() ?? "";
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dir, name)
    );

    // Suppress the disk event our own save produces (it can arrive a beat after
    // `isDirty` clears), so saving never flashes a false conflict banner.
    let justSaved = false;
    const saveSub = vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.toString() !== document.uri.toString()) return;
      justSaved = true;
      setTimeout(() => (justSaved = false), 500);
    });

    const onDisk = (uri: vscode.Uri) => {
      if (uri.toString() !== document.uri.toString()) return;
      if (justSaved || !document.isDirty) return;
      post({ type: "externalChange" });
    };

    return vscode.Disposable.from(
      watcher,
      saveSub,
      watcher.onDidChange(onDisk),
      // Atomic writes (write-temp-then-rename) surface as create, not change.
      watcher.onDidCreate(onDisk)
    );
  }

  /**
   * Apply a surgical {@link EditResult} to the document via a WorkspaceEdit.
   * Only the computed spans are replaced/inserted → minimal git diff.
   */
  private async applyEdits(
    document: vscode.TextDocument,
    { edits, reason }: EditResult,
    label: string
  ): Promise<void> {
    if (edits.length === 0) {
      if (reason) {
        console.warn(`[xcode-i18n] could not edit ${label}: ${reason}`);
        void vscode.window.showWarningMessage(`Couldn't update ${label}: ${reason}`);
      }
      return;
    }

    const wsEdit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      const start = document.positionAt(e.offset);
      const end = document.positionAt(e.offset + e.length);
      wsEdit.replace(document.uri, new vscode.Range(start, end), e.newText);
    }
    await vscode.workspace.applyEdit(wsEdit);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js")
    );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Xcode String Catalog</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Vendor dirs skipped when scanning source for key usages — mirrors the
 * Localizations tree's exclude so framework / Pods code never skews counts. */
const CODE_EXCLUDE_GLOB =
  "{**/Pods/**,**/*.xcframework/**,**/Carthage/**,**/build/**,**/DerivedData/**,**/node_modules/**,**/.build/**}";

/** workspaceState key holding every file's saved layout for this workspace. */
const LAYOUT_KEY = "xcodeI18n.layout";

interface LayoutRecord {
  /** Chosen target columns; null = never explicitly chosen (use inheritance). */
  targets: string[] | null;
  /** Column id → dragged pixel width. */
  widths: Record<string, number>;
}

interface LayoutStore {
  /** Per-file layout, keyed by workspace-relative path. */
  files: Record<string, LayoutRecord>;
  /** The most recent non-empty target set chosen anywhere in the workspace. */
  lastTargets: string[] | null;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
