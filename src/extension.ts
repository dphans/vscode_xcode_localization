import * as vscode from "vscode";
import { XcstringsEditorProvider } from "./editor/XcstringsEditorProvider";
import { LocalizationsTreeProvider } from "./tree/LocalizationsTreeProvider";

export function activate(context: vscode.ExtensionContext) {
  const editorProvider = XcstringsEditorProvider.register(context);

  // Sidebar → "open this language in the catalog grid", focused on a single
  // column (Key/source + that language). Stash the choice first so a freshly
  // opened editor applies it on ready; then open (or focus) the grid editor.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "xcodeI18n.openCatalogLanguage",
      async (uri: vscode.Uri, lang: string) => {
        editorProvider.selectCatalogLanguage(uri, lang);
        await vscode.commands.executeCommand(
          "vscode.openWith",
          uri,
          XcstringsEditorProvider.xcstringsViewType
        );
      }
    )
  );

  // Activity-bar "Localizations" view (native tree): lists .strings tables +
  // languages and .xcstrings catalogs with progress; clicking opens the file in
  // the grid editor.
  const tree = new LocalizationsTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("xcodeI18n.localizations", {
      treeDataProvider: tree,
    }),
    vscode.commands.registerCommand("xcodeI18n.refreshLocalizations", () =>
      tree.refresh()
    )
  );
  // Keep the view in sync with the filesystem (saves, add/remove languages).
  // Debounced so a burst of changes triggers one refresh.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => tree.refresh(), 250);
  };
  for (const glob of ["**/*.lproj/*.strings", "**/*.xcstrings"]) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(refresh);
    watcher.onDidChange(refresh);
    watcher.onDidDelete(refresh);
    context.subscriptions.push(watcher);
  }

  // Editor-title action: switch the active .xcstrings from the grid to the
  // built-in text editor (raw JSON). The editor/title menu passes the resource
  // URI; fall back to the active tab if it doesn't.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "xcodeI18n.openAsText",
      (uri?: vscode.Uri) => {
        const target = uri ?? activeResourceUri();
        if (target) {
          void vscode.commands.executeCommand(
            "vscode.openWith",
            target,
            "default"
          );
        }
      }
    )
  );
}

/** URI of the resource in the active editor tab (custom or text). */
function activeResourceUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  if (input instanceof vscode.TabInputText) return input.uri;
  return undefined;
}

export function deactivate() {}
