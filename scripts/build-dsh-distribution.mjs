// Build the installable plugin with its SDK without changing the desktop plugin's artifacts.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function buildDistribution(root, stage, release) {
  const source = join(root, "packages/dsh-plugin");
  const sdk = join(root, "packages/kaitu-dsh");
  const pkg = join(stage, "packages/dsh-plugin");
  mkdirSync(pkg, { recursive: true });
  symlinkSync(join(root, "docs"), join(stage, "docs"), "junction");
  cpSync(join(root, "tsconfig.base.json"), join(stage, "tsconfig.base.json"));
  symlinkSync(join(root, "node_modules"), join(stage, "node_modules"), "junction");
  symlinkSync(join(sdk, "node_modules"), join(pkg, "node_modules"), "junction");
  for (const dir of ["src", "scripts"]) cpSync(join(source, dir), join(pkg, dir), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  // Typert uses the source package identity for the shared Host and Client declarations.
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ ...manifest, ...release, name: manifest.name }));
  // Some DSH SDK declarations import types that are supplied by the host. Resolve those
  // imports, including module augmentations, against this SDK instead of the desktop SDK.
  const paths = {};
  const scope = join(sdk, "node_modules/@deepseek-ai");
  for (const name of readdirSync(scope)) {
    const directory = join(scope, name);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
      if (typeof entry?.types !== "string") continue;
      const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
      paths[specifier] = [join(directory, entry.types)];
    }
  }
  writeFileSync(
    join(pkg, "tsconfig.sdk.json"),
    JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: { paths },
    }),
  );
  for (const name of ["tsconfig.json", "tsconfig.client.json"]) {
    const config = JSON.parse(readFileSync(join(source, name), "utf8"));
    writeFileSync(join(pkg, name), JSON.stringify({ ...config, extends: "./tsconfig.sdk.json" }));
  }
  execFileSync(process.execPath, [join(pkg, "scripts/build.mjs"), release.name], {
    cwd: pkg,
    stdio: "inherit",
  });
  return pkg;
}
