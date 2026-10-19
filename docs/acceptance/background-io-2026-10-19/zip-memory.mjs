// 每种规模独立进程；仅使用随机合成附件，避免高重复文本掩盖归档大小与内存。
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const project = resolve(import.meta.dirname, "../../..");
if (process.argv[2] !== "--child") {
  const rows = [];
  for (const size of [16, 64]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [import.meta.filename, "--child", String(size)],
      { maxBuffer: 1024 * 1024 },
    );
    rows.push(JSON.parse(stdout));
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        method:
          "Independent real processes; 1 MiB random binary files. RSS sampled every 10ms includes all worker threads; sampled peak is a lower bound. maxRSS is also retained as raw Node resourceUsage output. No pass/fail timing or memory limit.",
        rows,
      },
      null,
      2,
    ),
  );
} else {
  const size = Number(process.argv[3]);
  const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-zip-memory-"));
  process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
  process.env.KAITU_APP_HOME = join(temporary, "app");
  const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
  try {
    const ws = await core.initWorkspace(join(temporary, "workspace"));
    const folder = join(ws.root, "health/files/synthetic");
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i < size; i++) fs.writeFileSync(join(folder, `${i}.bin`), randomBytes(1024 * 1024));
    const before = process.memoryUsage();
    let peakRss = before.rss;
    const timer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 10);
    const started = performance.now();
    const result = await core.exportWorkspaceAsync(ws);
    const elapsedMs = +(performance.now() - started).toFixed(2);
    const after = process.memoryUsage();
    peakRss = Math.max(peakRss, after.rss);
    clearInterval(timer);
    await result.dispose?.();
    console.log(
      JSON.stringify({
        syntheticAttachmentBytes: size * 1024 * 1024,
        zipBytes: result.bytes ?? Buffer.byteLength(result.base64, "base64"),
        base64Characters: result.base64?.length ?? 0,
        rssBeforeBytes: before.rss,
        sampledPeakRssBytes: peakRss,
        sampledRssIncreaseBytes: peakRss - before.rss,
        rssAfterBytes: after.rss,
        nodeResourceUsageMaxRSSRaw: process.resourceUsage().maxRSS,
        elapsedMs,
      }),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
