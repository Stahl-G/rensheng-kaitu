import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { clientStyles } from "./client-styles.mjs";
const pkg = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(pkg, "dist/standalone");
mkdirSync(resolve(output, "assets"), { recursive: true });
const worker = await build({
  entryPoints: [resolve(pkg, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
});
const styles = clientStyles(worker.outputFiles[0].text);
await build({
  entryPoints: [resolve(pkg, "src/standalone/main.tsx")],
  outfile: resolve(output, "assets/product.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  // 隐私说明等正文写成 Markdown 文件，按文本打包。
  loader: { ".md": "text", ".svg": "dataurl" },
  plugins: [styles.plugin],
});
writeFileSync(
  resolve(output, "assets/product.css"),
  `${readFileSync(resolve(pkg, "src/standalone/base.css"), "utf8")}\n${styles.css()}`,
);
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>人生开图</title><link rel="stylesheet" href="/assets/product.css"></head><body><p id="startup-error" role="alert" hidden></p><div id="root"></div><script type="module" src="/assets/product.js"></script></body></html>',
);
