// Build both sides in one file:
//   - extension host (Node, CommonJS, external "vscode")
//   - webview (browser, React, IIFE)
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  // Prefer a dependency's ESM build. Required for jsonc-parser: its UMD build
  // passes `require` dynamically, so esbuild cannot inline
  // `require("./impl/format")` → runtime error. The ESM build uses static
  // imports and bundles cleanly.
  mainFields: ["module", "main"],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  ...common,
  entryPoints: ["webview/index.tsx"],
  outfile: "media/webview.js",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
};

async function main() {
  const contexts = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);

  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("[esbuild] watching...");
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
    console.log("[esbuild] build done.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
