import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist/novel-plugins");
fs.mkdirSync(output, { recursive: true });
for (const folder of ["novel-plugin", "sf-plugin"]) {
  const pkg = join(root, "packages", folder);
  const manifest = JSON.parse(fs.readFileSync(join(pkg, "package.json"), "utf8"));
  const staging = join(output, manifest.name);
  fs.mkdirSync(join(staging, "dist"), { recursive: true });
  for (const file of ["index.js", "client.js"])
    if (fs.existsSync(join(pkg, "dist", file)))
      fs.copyFileSync(join(pkg, "dist", file), join(staging, "dist", file));
  for (const file of ["README.md", "LICENSE"]) fs.copyFileSync(join(pkg, file), join(staging, file));
  if (folder === "novel-plugin") {
    fs.cpSync(join(pkg, "lib"), join(staging, "lib"), { recursive: true });
    fs.copyFileSync(join(pkg, "cordis.example.yml"), join(staging, "cordis.example.yml"));
  }
  const sources = JSON.parse(fs.readFileSync(join(pkg, "dist/metafile.json"), "utf8"));
  const dependencyDirs = new Set(
    Object.keys(sources.inputs).flatMap((input) => {
      const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
      return match?.[1] ? [resolve(root, match[1])] : [];
    }),
  );
  const notices = ["# Bundled dependency licenses\n"];
  for (const dir of dependencyDirs) {
    if (!fs.existsSync(join(dir, "package.json"))) continue;
    const info = JSON.parse(fs.readFileSync(join(dir, "package.json"), "utf8"));
    notices.push(`## ${info.name} ${info.version}\nLicense: ${JSON.stringify(info.license)}\n`);
    for (const file of fs.readdirSync(dir).filter((name) => /^licen[cs]e(?:\.|$)/i.test(name))) {
      if (fs.statSync(join(dir, file)).isFile()) notices.push(fs.readFileSync(join(dir, file), "utf8"));
    }
  }
  fs.writeFileSync(join(staging, "THIRD_PARTY_LICENSES.md"), notices.join("\n\n"));
  // Runtime code is bundled; the unpublished workspace core is not an install dependency.
  manifest.devDependencies = undefined;
  manifest.scripts = undefined;
  manifest.dependencies["@kaitu/core"] = undefined;
  for (const entry of Object.values(manifest.exports)) if (typeof entry === "object") entry.types = undefined;
  manifest.files = ["dist", "lib", "README.md", "LICENSE", "THIRD_PARTY_LICENSES.md", "cordis.example.yml"];
  fs.writeFileSync(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", output], {
      cwd: staging,
      encoding: "utf8",
    }),
  );
  console.log(
    JSON.stringify({ name: manifest.name, tarball: join(output, packed[0].filename), size: packed[0].size }),
  );
}
