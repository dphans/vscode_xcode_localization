// Locating the `.lproj` sibling files of a `.strings` file, and picking the
// project's source (development) language.
//
// A `.strings` file lives at `<groupDir>/<lang>.lproj/<Table>.strings`. Its
// "siblings" are the same-named tables in the other `*.lproj` dirs under the
// SAME groupDir — that scoping naturally excludes vendor strings (Pods,
// frameworks) which live under different parents.

import * as vscode from "vscode";

export interface LprojGroup {
  /** Parent dir that holds the `*.lproj` dirs. */
  groupDir: vscode.Uri;
  /** Table name without extension, e.g. "Localizable". */
  basename: string;
  /** One entry per `<lang>.lproj/<basename>.strings` that exists. */
  files: { lang: string; uri: vscode.Uri }[];
}

/** "ru.lproj" → "ru", "Base.lproj" → "Base", anything else → null. */
export function langFromLproj(dirName: string): string | null {
  const m = /^(.+)\.lproj$/i.exec(dirName);
  return m ? m[1] : null;
}

function baseName(uri: vscode.Uri): string {
  const p = uri.path;
  const slash = p.lastIndexOf("/");
  return slash === -1 ? p : p.slice(slash + 1);
}

function parentOf(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, "..");
}

/**
 * Resolve the `.lproj` group for an opened `.strings` URI. A loose `.strings`
 * (not under a `*.lproj`) yields a single-file group with lang "und".
 */
export async function resolveLprojGroup(
  uri: vscode.Uri
): Promise<LprojGroup | null> {
  const fileName = baseName(uri);
  if (!fileName.endsWith(".strings")) return null;
  const table = fileName.slice(0, -".strings".length);

  const parent = parentOf(uri);
  const parentLang = langFromLproj(baseName(parent));

  if (!parentLang) {
    return { groupDir: parent, basename: table, files: [{ lang: "und", uri }] };
  }

  const groupDir = parentOf(parent);
  let dir: [string, vscode.FileType][];
  try {
    dir = await vscode.workspace.fs.readDirectory(groupDir);
  } catch {
    return { groupDir, basename: table, files: [{ lang: parentLang, uri }] };
  }

  const files: { lang: string; uri: vscode.Uri }[] = [];
  for (const [name, type] of dir) {
    if (type !== vscode.FileType.Directory) continue;
    const lang = langFromLproj(name);
    if (!lang) continue;
    const candidate = vscode.Uri.joinPath(groupDir, name, fileName);
    try {
      await vscode.workspace.fs.stat(candidate);
      files.push({ lang, uri: candidate });
    } catch {
      // No such table in this language — skip.
    }
  }
  if (!files.some((f) => f.uri.toString() === uri.toString())) {
    files.push({ lang: parentLang, uri });
  }
  files.sort((a, b) => (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0));
  return { groupDir, basename: table, files };
}

/** Read `developmentRegion` from the nearest `*.xcodeproj/project.pbxproj`. */
async function findDevelopmentRegion(
  start: vscode.Uri
): Promise<string | undefined> {
  let dir = start;
  for (let depth = 0; depth < 5; depth++) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      break;
    }
    const proj = entries.find(
      ([name, type]) =>
        type === vscode.FileType.Directory && name.endsWith(".xcodeproj")
    );
    if (proj) {
      const pbx = vscode.Uri.joinPath(dir, proj[0], "project.pbxproj");
      try {
        const doc = await vscode.workspace.openTextDocument(pbx);
        const m = /developmentRegion\s*=\s*([A-Za-z0-9_-]+)\s*;/.exec(doc.getText());
        if (m) return m[1];
      } catch {
        // unreadable pbxproj — fall through to heuristics
      }
      return undefined;
    }
    const up = parentOf(dir);
    if (up.toString() === dir.toString()) break;
    dir = up;
  }
  return undefined;
}

/**
 * Pick the source language for a group: the project's developmentRegion if it
 * has a file here, else Base, else en, else the first language alphabetically.
 */
export async function detectSourceLanguage(group: LprojGroup): Promise<string> {
  const langs = group.files.map((f) => f.lang);
  const has = (l: string) => langs.includes(l);

  const dev = await findDevelopmentRegion(group.groupDir);
  if (dev && has(dev)) return dev;
  if (has("Base")) return "Base";
  if (has("en")) return "en";
  return [...langs].sort()[0] ?? "";
}
