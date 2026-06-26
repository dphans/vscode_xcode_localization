import * as vscode from "vscode";
import * as path from "path";

// A minimal slice of the built-in Git extension API (`vscode.git`) — just enough
// to read a file's content at a ref and watch the repo for changes. Typed
// locally so we don't depend on @types for it.

interface GitRepositoryState {
  readonly onDidChange: vscode.Event<void>;
}
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  show(ref: string, filePath: string): Promise<string>;
}
interface GitAPI {
  readonly state: "uninitialized" | "initialized";
  readonly onDidChangeState: vscode.Event<"uninitialized" | "initialized">;
  getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitExtension {
  getAPI(version: 1): GitAPI;
}

let apiPromise: Promise<GitAPI | undefined> | undefined;

/** Resolve the Git API once, waiting until the extension has initialized. */
async function getGitApi(): Promise<GitAPI | undefined> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
      if (!ext) return undefined;
      if (!ext.isActive) await ext.activate();
      const api = ext.exports.getAPI(1);
      if (api.state !== "initialized") {
        await new Promise<void>((resolve) => {
          const d = api.onDidChangeState((s) => {
            if (s === "initialized") {
              d.dispose();
              resolve();
            }
          });
        });
      }
      return api;
    })();
  }
  return apiPromise;
}

export async function getRepository(
  uri: vscode.Uri
): Promise<GitRepository | null> {
  const api = await getGitApi();
  return api?.getRepository(uri) ?? null;
}

/** File content at HEAD, or null if untracked / not at HEAD / no git. */
export async function getHeadText(uri: vscode.Uri): Promise<string | null> {
  try {
    const repo = await getRepository(uri);
    if (!repo) return null;
    const rel = path
      .relative(repo.rootUri.fsPath, uri.fsPath)
      .split(path.sep)
      .join("/");
    return await repo.show("HEAD", rel);
  } catch {
    // Not in HEAD yet (new/untracked file) or git unavailable.
    return null;
  }
}
