// 把开图插件单独打成一个 DSH 插件包（npm 名 kaitu-dsh）：在 DSH 插件市场或插件页安装即可，
// Mac、Windows、Linux 通用，不需要先装开图 CLI。
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "dist/kaitu-dsh"));
const { build } = createRequire(join(root, "packages/dsh-plugin/package.json"))("esbuild");
const cli = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const plugin = JSON.parse(readFileSync(join(root, "packages/dsh-plugin/package.json"), "utf8"));
const name = "kaitu-dsh";

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, "dist"), { recursive: true });
cpSync(join(root, "packages/core/dist/validators"), join(output, "dist/validators"), { recursive: true });
await build({
  entryPoints: [join(root, "packages/dsh-plugin/src/index.ts")],
  outfile: join(output, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@deepseek-ai/*"],
  banner: {
    js: [
      'import { createRequire as kaituRequire } from "node:module";',
      'import { dirname as kaituDirname } from "node:path";',
      'import { fileURLToPath as kaituFileURLToPath } from "node:url";',
      "const require = kaituRequire(import.meta.url);",
      "const __filename = kaituFileURLToPath(import.meta.url);",
      "const __dirname = kaituDirname(__filename);",
    ].join("\n"),
  },
});
// Background entry points must ship with the independently installed plugin too.
for (const name of ["home-worker", "phone-worker"])
  cpSync(join(root, `packages/core/dist/${name}.js`), join(output, `dist/${name}.js`));
cpSync(join(root, "packages/dsh-plugin/dist/client.js"), join(output, "dist/client.js"));
// assetsRoot() 从 dist/ 往上找 schemas/ 与 templates/；城市数据按 ../data/cities.json 读。
for (const [from, to] of [
  ["schemas", "schemas"],
  ["templates", "templates"],
  ["packages/core/data", "data"],
  ["LICENSE", "LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
])
  cpSync(join(root, from), join(output, to), { recursive: true });

// 插件运行时引用的 DSH 包由宿主版本决定，按插件声明的精确版本装。
const imports = new Set(
  [...readFileSync(join(output, "dist/index.js"), "utf8").matchAll(/from ?"(@deepseek-ai\/[\w-]+)/g)].map(
    ([, dep]) => dep,
  ),
);
const dependencies = Object.fromEntries(
  [...imports].sort().map((dep) => {
    const version = plugin.dependencies[dep] ?? cli.dependencies[dep];
    if (!version) throw new Error(`插件引用了未声明的依赖：${dep}`);
    return [dep, version];
  }),
);
writeFileSync(
  join(output, "cordis.patch.yml"),
  ["- id: tool-skill", "  disabled: false", "- insert:", "    - id: kaitu", `      name: ${name}`, ""].join(
    "\n",
  ),
);
writeFileSync(
  join(output, "README.md"),
  `# 人生开图 · DSH 插件\n\n在 DeepSeek Harness 里装上开图：今天、开图、资料三个页面，以及开图的 AI 工具。\n\n桌面版：在 DSH 的插件市场添加插件目录 https://kaitu.si/plugins/index.json ，找到「人生开图」安装；也可以在插件页直接安装 \`${name}\`。\n\n网页版或命令行：\n\n\`\`\`sh\ndsh plugin --profile web add ${name}\n\`\`\`\n\n资料默认放在用户目录下的 \`kaitu\` 文件夹。说明见 https://kaitu.si/docs/ 。\n`,
);
writeFileSync(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name,
      version: cli.version,
      description: "人生开图的 DeepSeek Harness 插件：今天、开图、资料和开图的 AI 工具",
      license: "MIT",
      homepage: "https://kaitu.si",
      repository: { type: "git", url: "git+https://github.com/Stahl-G/rensheng-kaitu.git" },
      type: "module",
      main: "dist/index.js",
      exports: {
        ".": "./dist/index.js",
        "./client": "./dist/client.js",
        "./package.json": "./package.json",
      },
      files: [
        "dist",
        "schemas",
        "templates",
        "data",
        "cordis.patch.yml",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
      ],
      engines: { node: "^22.19.0 || >=24" },
      dsh: { ...plugin.dsh, bundle: { patch: "./cordis.patch.yml" } },
      dependencies,
      peerDependencies: plugin.peerDependencies,
    },
    null,
    2,
  )}\n`,
);
console.log(`DSH 插件包：${output}`);
