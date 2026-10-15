import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { transform } from "lightningcss";
const pkg = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(pkg, "dist/standalone");
mkdirSync(resolve(output, "assets"), { recursive: true });
const css = [];
const worker = await build({
  entryPoints: [resolve(pkg, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
});
await build({
  entryPoints: [resolve(pkg, "src/standalone/main.tsx")],
  outfile: resolve(output, "assets/product.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  plugins: [
    {
      name: "kaitu-product-styles",
      setup(builder) {
        builder.onLoad({ filter: /maplibre-gl-worker\.mjs$/ }, () => ({
          contents: `export default ${JSON.stringify(worker.outputFiles[0].text)}`,
          loader: "js",
        }));
        builder.onLoad({ filter: /maplibre-gl\.css$/ }, ({ path }) => {
          css.push(readFileSync(path, "utf8"));
          return { contents: "", loader: "js" };
        });
        builder.onLoad({ filter: /\.module\.css$/ }, ({ path }) => {
          const result = transform({
            filename: path,
            code: readFileSync(path),
            cssModules: { pattern: "kt_[local]_[hash]" },
          });
          css.push(result.code.toString());
          return {
            contents: `export default ${JSON.stringify(Object.fromEntries(Object.entries(result.exports).map(([key, value]) => [key, value.name])))}`,
            loader: "js",
            resolveDir: dirname(path),
          };
        });
      },
    },
  ],
});
writeFileSync(
  resolve(output, "assets/product.css"),
  `html,body,#root{height:100%;margin:0}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}#startup-error{padding:12px;background:#fff1eb;color:#7a2d12}${css.join("\n")}`,
);
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>开图</title><link rel="stylesheet" href="/assets/product.css"></head><body><p id="startup-error" role="alert" hidden></p><div id="root"></div><script type="module" src="/assets/product.js"></script></body></html>',
);
