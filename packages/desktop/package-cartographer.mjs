import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Native N-API canvas stays external to esbuild; ship the installed platform binary with the worker. */
export async function bundleCartographerWorker(destination, workerDirectory = "dist", target = undefined) {
  // Desktop installers have explicit supported targets. CLI/Web builds use the installed host binding.
  if (
    target &&
    (!["darwin-arm64", "win32-x64"].includes(`${target.platform}-${target.arch}`) ||
      target.platform !== process.platform ||
      target.arch !== process.arch)
  )
    throw new Error(
      `Unsupported Cartographer build target ${target.platform}-${target.arch} on ${process.platform}-${process.arch}; build macOS arm64 / Windows x64 on matching runners. Universal and cross builds are unsupported.`,
    );
  const requirePlugin = createRequire(join(root, "packages/dsh-plugin/package.json"));
  const { build } = requirePlugin("esbuild");
  await build({
    entryPoints: [join(root, "packages/core/dist/life-atlas-worker.js")],
    outfile: join(destination, workerDirectory, "life-atlas-worker.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire as kaituRequire } from "node:module"; const require = kaituRequire(import.meta.url);',
    },
    external: ["@napi-rs/canvas"],
  });
  const requireAtlas = createRequire(join(root, "packages/cartographer/package.json"));
  const canvasManifest = requireAtlas.resolve("@napi-rs/canvas/package.json");
  const requireCanvas = createRequire(canvasManifest);
  const musl = process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime;
  const nativePrefix = `@napi-rs/canvas-${process.platform}-${process.arch}`;
  const nativeName = Object.keys(JSON.parse(readFileSync(canvasManifest, "utf8")).optionalDependencies).find(
    (name) =>
      (name === nativePrefix || name.startsWith(`${nativePrefix}-`)) &&
      (process.platform !== "linux" || name.endsWith("-musl") === musl),
  );
  if (!nativeName) throw new Error(`No canvas binding for ${process.platform}-${process.arch}`);
  for (const name of ["@napi-rs/canvas", nativeName]) {
    const source = dirname(requireCanvas.resolve(`${name}/package.json`));
    const target = join(destination, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  }
  cpSync(join(root, "packages/cartographer/fonts"), join(destination, "data/cartographer/fonts"), {
    recursive: true,
  });
  mkdirSync(join(destination, "licenses"), { recursive: true });
  cpSync(join(root, "packages/cartographer/LICENSE"), join(destination, "licenses/cartographer.txt"));
  cpSync(
    join(root, "packages/cartographer/UPSTREAM.json"),
    join(destination, "licenses/cartographer-source.json"),
  );
  cpSync(join(dirname(canvasManifest), "LICENSE"), join(destination, "licenses/canvas.txt"));
  if (!target?.deferNativeValidation) verifyCartographerPayload(destination, nativeName);
}

// A complete macOS App validates native loading after its bundle has been signed.
export function verifyCartographerPayload(destination, nativeName) {
  const proof = execFileSync(
    process.execPath,
    [
      "-e",
      `
    const {createRequire}=require('node:module'), {join}=require('node:path');
    const requirePayload=createRequire(join(process.cwd(),'package.json'));
    const {createCanvas,GlobalFonts}=requirePayload('@napi-rs/canvas');
    if(!GlobalFonts.registerFromPath(join(process.cwd(),'data/cartographer/fonts/NotoSerifSC-Regular.otf'),'Kaitu Font Check')) throw Error('Missing CJK font');
    const c=createCanvas(100,80),ctx=c.getContext('2d'); ctx.font='40px "Kaitu Font Check"';
    const glyphs=['健','康','学','习'].map(ch=>{ctx.clearRect(0,0,100,80);ctx.fillText(ch,0,55);return Buffer.from(ctx.getImageData(0,0,100,80).data)});
    if(glyphs.some((g,i)=>!g.some(v=>v)||(i>0&&g.equals(glyphs[0])))) throw Error('CJK glyphs are missing');
    process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,nativePackage:${JSON.stringify(nativeName)},font:'Noto Serif SC',chineseGlyphs:4,pngBytes:c.toBuffer('image/png').length})+'\\n',()=>process.exit(0));
  `,
    ],
    { cwd: destination, encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL" },
  );
  console.log(`Cartographer payload verified: ${proof.trim()}`);
}
