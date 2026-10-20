// Build and serve the real learning components with deterministic local service stubs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../packages/dsh-plugin/package.json", import.meta.url));
const { build } = require("esbuild");
const base = mkdtempSync(join(tmpdir(), "kaitu-learning-ui-"));
await build({
  entryPoints: [fileURLToPath(new URL("./fixtures/learning-ui.tsx", import.meta.url))],
  outfile: join(base, "fixture.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  alias: {
    react: fileURLToPath(new URL("../packages/dsh-plugin/node_modules/react", import.meta.url)),
    "react-dom": fileURLToPath(new URL("../packages/dsh-plugin/node_modules/react-dom", import.meta.url)),
  },
});
writeFileSync(
  join(base, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>合成学习 UI 回归</title><link rel="stylesheet" href="/fixture.css"><style>body{font:15px system-ui;margin:24px;background:#faf9f6}section{margin-bottom:24px}button{margin:4px}label{display:grid;gap:6px}output{display:block;padding:8px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
);
const server = createServer((req, res) => {
  const file =
    req.url === "/fixture.js" ? "fixture.js" : req.url === "/fixture.css" ? "fixture.css" : "index.html";
  res.setHeader(
    "Content-Type",
    file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html; charset=utf-8",
  );
  res.end(readFileSync(join(base, file)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
console.log(`Synthetic-only UI fixture: http://127.0.0.1:${server.address().port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => {
      rmSync(base, { recursive: true, force: true });
      process.exit(0);
    });
  });
