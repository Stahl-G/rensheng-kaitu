import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { build } = createRequire(join(root, "packages/dsh-plugin/package.json"))("esbuild");
const directory = join(root, "schemas");
const output = join(root, "packages/core/dist/validators");
const hash = createHash("sha256");
const schemas = readdirSync(directory)
  .filter((name) => name.endsWith(".schema.json"))
  .sort()
  .map((name) => {
    const text = readFileSync(join(directory, name), "utf8");
    hash.update(name).update("\0").update(text).update("\0");
    return { name, schema: JSON.parse(text) };
  });
const sourceHash = hash.digest("hex");
const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true } });
addFormats(ajv);
for (const { schema } of schemas) ajv.addSchema(schema);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const { name, schema } of schemas) {
  await build({
    stdin: {
      contents: standaloneCode(ajv, ajv.getSchema(schema.$id)),
      resolveDir: join(root, "packages/core"),
    },
    outfile: join(output, `${sourceHash.slice(0, 16)}-${name}.cjs`),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
  });
}
writeFileSync(join(output, "manifest.json"), JSON.stringify({ sourceHash }));

// Use the same self-contained workers in core, CLI, native App and installed plugin.
for (const name of ["home-worker", "phone-worker"])
  await build({
    entryPoints: [join(root, `packages/core/src/${name}.ts`)],
    outfile: join(root, `packages/core/dist/${name}.js`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["better-sqlite3"],
    banner: {
      js: 'import { createRequire as workerRequire } from "node:module"; const require = workerRequire(import.meta.url);',
    },
  });
