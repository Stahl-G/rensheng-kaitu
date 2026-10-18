import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { schemas } from "@kaitu/core";
import { expect, it } from "vitest";

const { zipSync } = createRequire(new URL("../../core/package.json", import.meta.url))("fflate");

it("预览 worker 退出失败时输出原错误，不被数字退出码的 TypeError 覆盖", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-worker-error-"));
  const root = join(temp, "workspace");
  const env = {
    ...process.env,
    KAITU_LOCAL_STATE_DIR: join(temp, "state"),
    KAITU_APP_HOME: join(temp, "app"),
  };
  try {
    await promisify(execFile)(process.execPath, ["packages/cli/dist/main.js", "init", "--dir", root], {
      env,
    });
    const hook = join(temp, "worker-error.cjs");
    writeFileSync(
      hook,
      'if (process.argv[1].endsWith("/phone-worker.js")) throw new Error("Synthetic worker failure");',
    );
    const failure = await promisify(execFile)(
      process.execPath,
      ["packages/cli/dist/main.js", "phone", "run", "--dry-run", "--dir", root],
      { env: { ...env, NODE_OPTIONS: `--require=${hook}` } },
    ).catch((error) => error);
    expect(failure.code).toBe(2);
    expect(failure.stderr).toContain("Error: Synthetic worker failure");
    expect(failure.stderr).not.toContain("TypeError");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it("重复健康输入的预览不虚报历史版本，正式运行也不重写手机快照", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-duplicate-health-"));
  const root = join(temp, "workspace");
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["packages/cli/dist/main.js", ...args, "--dir", root, "--json-out"],
          {
            env: {
              ...process.env,
              HOME: join(temp, "home"),
              KAITU_LOCAL_STATE_DIR: join(temp, "state"),
              KAITU_APP_HOME: join(temp, "app"),
            },
          },
        )
      ).stdout,
    );
  const xml =
    '<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Synthetic" unit="kg" value="70" ' +
    'startDate="2026-10-17 08:00:00 +0800" endDate="2026-10-17 08:00:00 +0800"/></HealthData>';
  try {
    await run("init");
    writeFileSync(join(root, "inbox/health/export.xml"), xml);
    await run("phone", "run", "--as", "Synthetic");
    const versions = await run("history");
    writeFileSync(join(root, "inbox/health/export.xml"), xml);
    const preview = await run("phone", "run", "--as", "Synthetic", "--dry-run");
    expect(preview.changes.some((change: { path: string }) => change.path === ".kaitu/history.git")).toBe(
      false,
    );
    expect(preview.changes.filter((change: { path: string }) => change.path.startsWith("phone/"))).toEqual(
      [],
    );
    expect((await run("phone", "run", "--as", "Synthetic")).snapshots).toBe(0);
    expect(await run("history")).toEqual(versions);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it("phone run 预览隔离工作区和状态，正式运行得到相同操作结果，重复运行不写入", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-command-"));
  const env = {
    ...process.env,
    KAITU_LOCAL_STATE_DIR: join(temp, "state"),
    KAITU_APP_HOME: join(temp, "app"),
  };
  const root = join(temp, "GoogleDrive-synthetic", "kaitu");
  const run = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["packages/cli/dist/main.js", ...args, "--dir", root, "--json-out"],
      { env },
    );
    return JSON.parse(stdout);
  };
  const files = () =>
    Object.fromEntries(
      readdirSync(temp, { recursive: true, withFileTypes: true }).map((entry) => {
        const path = join(entry.parentPath, entry.name);
        const stat = statSync(path);
        return [
          path,
          { mtime: stat.mtimeMs, body: entry.isFile() ? readFileSync(path).toString("base64") : null },
        ];
      }),
    );
  try {
    await run("init");
    const note = "ios-3fa9c1d2-01K7M8BG000000000000000001.note.md";
    const actions = "ios-3fa9c1d2-01K7M8BG000000000000000002.actions.jsonl";
    writeFileSync(join(root, "inbox/agents", note), "---\nkind: capture\nagent: iPhone\n---\n合成手机原文\n");
    writeFileSync(
      join(root, "me/STATUS.md"),
      "---\nupdated: null\nnext:\n  - id: synthetic-next\n    title: 合成下一步\n    status: todo\n---\n",
    );
    writeFileSync(
      join(root, "inbox/agents", actions),
      JSON.stringify({
        client_id: "01K7M8BG000000000000000003",
        at: new Date().toISOString(),
        device: "3fa9c1d2",
        op: "complete_next",
        args: { file: "me/STATUS.md", id: "synthetic-next" },
      }),
    );
    const before = files();
    const preview = await run("phone", "run", "--as", "Dot", "--dry-run");
    expect(files()).toEqual(before);
    expect(preview.receipts.map((r: { status: string }) => r.status)).toEqual(["applied", "applied"]);
    const todayChange = preview.changes.find((c: { path: string }) => c.path === "phone/today.json");
    expect(JSON.parse(todayChange.after).next).toEqual([]);
    const actual = await run("phone", "run", "--as", "Dot");
    expect(actual.inbox).toEqual(preview.inbox);
    expect(actual.receipts.map((r: { ref: string; status: string }) => [r.ref, r.status])).toEqual(
      preview.receipts.map((r: { ref: string; status: string }) => [r.ref, r.status]),
    );
    for (const name of ["today", "week", "map", "library", "receipts"]) {
      const value = JSON.parse(readFileSync(join(root, `phone/${name}.json`), "utf8"));
      const validate = schemas().builtin(`phone-${name}.schema.json`);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      if (name !== "receipts") expect(value.generator).toEqual({ kind: "agent", name: "Dot", spec: 1 });
    }
    const previewWeek = JSON.parse(
      preview.changes.find((c: { path: string }) => c.path === "phone/week.json").after,
    );
    const actualWeek = JSON.parse(readFileSync(join(root, "phone/week.json"), "utf8"));
    expect(previewWeek.changes.map((c: { message: string }) => c.message)).toEqual(
      actualWeek.changes.map((c: { message: string }) => c.message),
    );
    expect(existsSync(join(root, "inbox/agents", note))).toBe(false);
    const after = files();
    expect((await run("phone", "run", "--as", "Dot")).snapshots).toBe(0);
    expect(files()).toEqual(after);
    expect((await run("phone", "run", "--as", "Dot", "--dry-run")).changes).toEqual([]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it("预览保留 files/cache/chats 项目、自定义模块、ZIP/XML/外部健康输入和二进制附件", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-compat-"));
  const root = join(temp, "workspace");
  const env = {
    ...process.env,
    HOME: join(temp, "home"),
    KAITU_LOCAL_STATE_DIR: join(temp, "state"),
    KAITU_APP_HOME: join(temp, "app"),
  };
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["packages/cli/dist/main.js", ...args, "--dir", root, "--json-out"],
          { env },
        )
      ).stdout,
    );
  const put = (path: string, content: string | Uint8Array) => {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  };
  const inventory = () =>
    Object.fromEntries(
      readdirSync(temp, { recursive: true, withFileTypes: true }).map((e) => {
        const path = join(e.parentPath, e.name);
        return [
          path,
          { mtime: statSync(path).mtimeMs, bytes: e.isFile() ? readFileSync(path).toString("base64") : null },
        ];
      }),
    );
  const normalized = (value: unknown): unknown =>
    JSON.parse(
      JSON.stringify(value).replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
        "<time>",
      ),
    );
  try {
    await run("init");
    const targets = ["projects/files", "projects/cache", "projects/chats", "cache"];
    put(
      "cache/module.json",
      JSON.stringify({ id: "cache", name: "合成自定义模块", visibility: "nav", version: 1 }),
    );
    for (const [i, path] of targets.entries())
      put(
        `${path}/STATUS.md`,
        `---\ntitle: 合成 ${path}\nkind: work\nstage: active\nlinks: []\nupdated: null\nnext:\n  - id: next-${i}\n    title: 合成行动 ${i}\n    status: todo\n---\n`,
      );
    put(
      "inbox/agents/ios-3fa9c1d2-01K7M8BG000000000000000004.actions.jsonl",
      targets
        .map((file, i) =>
          JSON.stringify({
            client_id: String(i + 10).padStart(26, "0"),
            at: new Date().toISOString(),
            device: "3fa9c1d2",
            op: "complete_next",
            args: { file: `${file}/STATUS.md`, id: `next-${i}` },
          }),
        )
        .join("\n"),
    );
    const xml = (day: string, value: number) =>
      `<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Synthetic" unit="kg" value="${value}" startDate="${day} 08:00:00 +0800" endDate="${day} 08:00:00 +0800"/></HealthData>`;
    put("inbox/health/export.xml", xml("2026-10-17", 70));
    put(
      "inbox/health/export.zip",
      zipSync({ "apple_health_export/export.xml": Buffer.from(xml("2026-10-18", 71)) }),
    );
    const external = join(temp, "external");
    mkdirSync(external);
    writeFileSync(
      join(external, "daily.health.json"),
      JSON.stringify({
        format: "kaitu.health.v1",
        samples: [
          {
            type: "body_mass",
            start: "2026-10-19T08:00:00+08:00",
            end: "2026-10-19T08:00:00+08:00",
            value: 72,
            unit: "kg",
            source: "Synthetic",
          },
        ],
      }),
    );
    const config = JSON.parse(readFileSync(join(root, ".kaitu/config.json"), "utf8"));
    put(".kaitu/config.json", JSON.stringify({ ...config, health_inbox_external: [external] }));
    const attachment = Buffer.from([0, 255, 128, 1]);
    put("inbox/agents/synthetic.bin", attachment);
    const before = inventory();
    const preview = await run("phone", "run", "--as", "Dot", "--dry-run");
    expect(inventory()).toEqual(before);
    expect(
      preview.receipts.map((r: { status: string }) => r.status),
      JSON.stringify(preview.receipts),
    ).toEqual(["applied", "applied", "applied", "applied"]);
    const result = await run("phone", "run", "--as", "Dot");
    expect(result.inbox).toEqual(preview.inbox);
    for (const path of targets)
      expect(readFileSync(join(root, path, "STATUS.md"), "utf8")).toContain("status: done");
    for (const name of ["today", "week", "map", "library", "receipts"]) {
      const path = `phone/${name}.json`;
      const planned = preview.changes.find((c: { path: string }) => c.path === path);
      expect(normalized(JSON.parse(planned.after))).toEqual(
        normalized(JSON.parse(readFileSync(join(root, path), "utf8"))),
      );
    }
    const savedAttachment = preview.changes.find(
      (c: { path: string }) => c.path.startsWith("inbox/notes/") && c.path.endsWith("/files/synthetic.bin"),
    );
    expect(savedAttachment.afterBytes).toBe(attachment.length);
    expect(readFileSync(join(root, savedAttachment.path))).toEqual(attachment);
    const dataFiles = readdirSync(join(root, "health/data/metrics"));
    const metrics = dataFiles.flatMap((file) =>
      readFileSync(join(root, "health/data/metrics", file), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
    expect(metrics.map((r) => r.value).sort()).toEqual([70, 71, 72]);
    const after = inventory();
    expect((await run("phone", "run", "--as", "Dot")).snapshots).toBe(0);
    expect(inventory()).toEqual(after);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
