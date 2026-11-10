import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
async function compile(relative = "") {
  await mkdir(join(root, "dist", relative), { recursive: true });
  for (const file of await readdir(join(root, "src", relative), { withFileTypes: true })) {
    const path = join(relative, file.name);
    if (file.isDirectory()) await compile(path);
    else if (file.name.endsWith(".ts")) {
      const source = await readFile(join(root, "src", path), "utf8");
      await writeFile(join(root, "dist", path.replace(/\.ts$/, ".js")), stripTypeScriptTypes(source));
    } else await copyFile(join(root, "src", path), join(root, "dist", path));
  }
}
await compile();
