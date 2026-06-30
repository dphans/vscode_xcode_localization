# Repository Guidelines

## Project Structure & Module Organization

This repository is a VS Code extension for editing Xcode localization files. Extension host code lives in `src/`, with feature areas split into `editor/`, `tree/`, and shared utilities under `src/shared/`. The React webview UI lives in `webview/`; `webview/App.tsx`, `Grid.tsx`, and related files implement the grid editor. Static assets, icons, and README screenshots are in `assets/`. Build output is written to `dist/` and should be treated as generated.

## Build, Test, and Development Commands

- `npm install`: install extension, React, TypeScript, and esbuild dependencies.
- `npm run build`: bundle the extension and webview into `dist/`.
- `npm run watch`: run esbuild in watch mode while developing.
- `npm run typecheck`: run TypeScript strict checking with no emitted files.
- `npm run vscode:prepublish`: production bundle used before packaging or publishing.

For local manual testing, open the folder in VS Code and launch the extension host from the debugger, then open a `.xcstrings` or `.strings` file.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode enabled. Follow the existing two-space JSON formatting and semicolon-light TypeScript style used in the repo. Prefer focused modules with descriptive names, such as `xcstrings.ts`, `editStrings.ts`, or `LanguagePicker.tsx`. React components use `PascalCase`; shared utility functions and variables use `camelCase`. Keep parser and edit logic in `src/shared/` when it must be reused by both extension and webview code.

## Testing Guidelines

No automated test script is currently defined in `package.json`. Before submitting changes, run `npm run typecheck` and `npm run build`. Manually verify editor behavior in the VS Code extension host, especially save behavior and clean diffs for `.xcstrings` and legacy `.strings` edits. When adding tests later, prefer colocated `*.test.ts` files near the module under test.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style prefixes such as `feat:` and `chore:`; follow that pattern where practical, for example `feat: add stale translation filter`. Pull requests should include a short summary, validation commands run, and screenshots or GIFs for visible webview changes. Link related issues when available and call out localization file format edge cases.

## Security & Configuration Tips

Do not commit local VS Code state, generated dependency folders, or private localization samples. Keep extension settings under the `xcodeI18n.*` namespace, and avoid broad workspace scans beyond the source and localization paths already documented in the README.
