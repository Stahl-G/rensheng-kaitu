import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { clientStyles } from "./client-styles.mjs";

const pkg = fileURLToPath(new URL("..", import.meta.url));
// A copyable directory for the existing plain GitHub Pages site. No deployment or gh-pages write.
const output = resolve(pkg, "../../dist/site-preview/testsite");
mkdirSync(resolve(output, "assets"), { recursive: true });
const styles = clientStyles("");
const result = await build({
  entryPoints: [resolve(pkg, "src/testsite/main.tsx")],
  outfile: resolve(output, "assets/testsite.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  metafile: true,
  write: false,
  plugins: [styles.plugin],
});
// Fail the preview build if a future component starts pulling the native AI/host runtime into it.
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
  /\/src\/(standalone|host)\/|\/AskPage\.tsx$|\/typert[^/]*\./.test(path),
);
if (forbidden.length) throw new Error(`TestSite must stay browser-only: ${forbidden.join(", ")}`);
const script = result.outputFiles[0].contents;
const css = `${readFileSync(resolve(pkg, "src/standalone/base.css"), "utf8")}\n${styles.css()}`;
const stamp = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const scriptName = `testsite.${stamp(script)}.js`;
const styleName = `testsite.${stamp(css)}.css`;
writeFileSync(resolve(output, "assets", scriptName), script);
writeFileSync(resolve(output, "assets", styleName), css);
writeFileSync(
  resolve(output, "index.html"),
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>开图 · 浏览器示例 / Kaitu browser demo</title><link rel="stylesheet" href="./assets/${styleName}"></head>
<body><div id="root"></div><noscript>请启用 JavaScript 体验合成示例。 / Enable JavaScript for the synthetic demo.</noscript>
<script type="module" src="./assets/${scriptName}"></script></body></html>\n`,
);
console.log(`Browser-only preview: ${output}`);
