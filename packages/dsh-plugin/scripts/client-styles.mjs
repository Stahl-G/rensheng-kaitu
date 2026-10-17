import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { transform } from "lightningcss";

// esbuild loads modules concurrently. Keep shared rules before component rules in both clients.
export function clientStyles(worker) {
  const styles = new Map();
  const rank = (path) =>
    path.endsWith("/maplibre-gl.css") ? 0 : path.endsWith("/Prototype.module.css") ? 1 : 2;
  return {
    css: () =>
      [...styles.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
        .map(([, code]) => code)
        .join("\n"),
    plugin: {
      name: "kaitu-client-styles",
      setup(builder) {
        builder.onLoad({ filter: /maplibre-gl-worker\.mjs$/ }, () => ({
          contents: `export default ${JSON.stringify(worker)}`,
          loader: "js",
        }));
        builder.onLoad({ filter: /maplibre-gl\.css$/ }, ({ path }) => {
          styles.set(path.replaceAll("\\", "/"), readFileSync(path, "utf8"));
          return { contents: "", loader: "js" };
        });
        builder.onLoad({ filter: /\.module\.css$/ }, ({ path }) => {
          const result = transform({
            filename: path,
            code: readFileSync(path),
            cssModules: { pattern: "kt_[local]_[hash]" },
          });
          styles.set(path.replaceAll("\\", "/"), result.code.toString());
          const names = Object.fromEntries(
            Object.entries(result.exports).map(([key, value]) => [key, value.name]),
          );
          return {
            contents: `export default ${JSON.stringify(names)}`,
            loader: "js",
            resolveDir: dirname(path),
          };
        });
      },
    },
  };
}
