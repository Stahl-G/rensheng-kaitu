import fs from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import git from "isomorphic-git";
import { expect, it } from "vitest";
import {
  createProject,
  listProjects,
  readProject,
  readRecords,
  setProject,
  syncProject,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("正文 glob、Markdown 和 docx 混合计数，重复同步修订当天记录与日志", async () => {
  const root = tmp();
  const ws = await freshWorkspace();
  try {
    const manuscript = join(root, "manuscript");
    fs.mkdirSync(manuscript);
    fs.writeFileSync(
      join(manuscript, "chapter.md"),
      "# 月光\n\n**你好世界**，hello world! [继续](https://example.test)\n",
    );
    fs.writeFileSync(
      join(manuscript, "chapter.docx"),
      zipSync({
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>月球 night sky</w:t></w:r></w:p></w:body></w:document>',
        ),
      }),
    );
    for (const dir of ["archived", "node_modules", ".hidden"]) {
      fs.mkdirSync(join(manuscript, dir));
      fs.writeFileSync(join(manuscript, dir, "ignored.md"), "不应计数");
    }
    fs.writeFileSync(join(root, "outline.md"), "不应计数");
    const { slug } = await createProject(ws, {
      title: "合成写作",
      kind: "personal",
      links: [{ path: root, role: "manuscript", include: ["manuscript/**/*.{md,docx}"] }],
    });
    await setProject(ws, slug, { next: [{ id: "draft", title: "续写", status: "todo" }] });
    const first = await syncProject(ws, slug, { now: new Date("2026-10-14T04:00:00Z") });
    expect(first.issues).toEqual([]);
    expect(first.metrics[0]?.value).toBe(14);
    fs.appendFileSync(join(manuscript, "chapter.md"), "\n星海 one more\n");
    await syncProject(ws, slug, { now: new Date("2026-10-15T04:00:00Z") });
    fs.appendFileSync(join(manuscript, "chapter.md"), "继续\n");
    const last = await syncProject(ws, slug, { now: new Date("2026-10-15T05:00:00Z") });
    expect(last.issues).toEqual([]);
    const rows = readRecords(ws, "project_metric");
    expect(rows.map((r) => r.value)).toEqual([14, 20]);
    expect(rows[1]?.rev).toBe(2);
    const log = readProject(ws, slug).log;
    expect(log.split("<!-- sync:words -->")).toHaveLength(3);
    expect(log).toContain("20（+6）");
    expect(listProjects(ws, { now: new Date("2026-10-15T05:00:00Z") })[0]?.recent7.words).toBe(6);
    const snapshot = rows.map((r) => ({ ...r }));
    fs.rmSync(root, { recursive: true });
    expect((await syncProject(ws, slug)).issues).toHaveLength(1);
    expect(readRecords(ws, "project_metric")).toEqual(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
});

it("只读同步合成仓库的已结束日期提交，重跑不重复计数且文件与 .git 保持原样", async () => {
  const repo = tmp();
  const ws = await freshWorkspace();
  const files = (root: string): Record<string, string> => {
    const out: Record<string, string> = {};
    function walk(dir: string) {
      for (const item of fs.readdirSync(join(root, dir), { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) walk(path);
        else out[path] = fs.readFileSync(join(root, path)).toString("base64");
      }
    }
    walk("");
    return out;
  };
  try {
    await git.init({ fs, dir: repo, defaultBranch: "main" });
    fs.writeFileSync(join(repo, "chapter.txt"), "old");
    await git.add({ fs, dir: repo, filepath: "chapter.txt" });
    const old = await git.commit({
      fs,
      dir: repo,
      message: "old",
      author: {
        name: "Test",
        email: "test@localhost",
        timestamp: Date.parse("2026-09-01T00:00:00Z") / 1000,
      },
    });
    for (const [index, title] of ["first chapter", "edit chapter"].entries()) {
      await git.branch({ fs, dir: repo, ref: `work-${index}`, object: old, checkout: true });
      fs.writeFileSync(join(repo, "chapter.txt"), `synthetic ${index}`);
      await git.add({ fs, dir: repo, filepath: "chapter.txt" });
      await git.commit({
        fs,
        dir: repo,
        message: title,
        author: {
          name: "Test",
          email: "test@localhost",
          timestamp: Date.parse(index === 0 ? "2026-10-13T16:30:00Z" : "2026-10-14T01:00:00Z") / 1000,
          timezoneOffset: 0,
        },
      });
    }
    await git.addRemote({ fs, dir: repo, remote: "origin", url: "https://example.test/offline.git" });
    await git.writeRef({
      fs,
      dir: repo,
      ref: "refs/remotes/origin/shared",
      value: await git.resolveRef({ fs, dir: repo, ref: "HEAD" }),
    });
    await git.writeRef({
      fs,
      dir: repo,
      ref: "refs/remotes/orphan/mirror",
      value: await git.resolveRef({ fs, dir: repo, ref: "work-0" }),
    });
    await git.checkout({ fs, dir: repo, ref: "main" });
    const before = files(repo);
    const head = await git.resolveRef({ fs, dir: repo, ref: "HEAD" });
    const { slug } = await createProject(ws, {
      title: "synthetic-code",
      kind: "work",
      links: [{ path: repo, role: "repo" }],
    });
    expect((await syncProject(ws, slug, { now: new Date("2026-10-14T05:00:00Z") })).metrics).toEqual([]);
    await syncProject(ws, slug, { now: new Date("2026-10-15T05:00:00Z") });
    await syncProject(ws, slug, { now: new Date("2026-10-15T06:00:00Z") });
    expect(
      readRecords(ws, "project_metric").map((r) => ({ kind: r.kind, value: r.value, detail: r.detail })),
    ).toEqual([{ kind: "commits", value: 2, detail: ["edit chapter", "first chapter"] }]);
    expect(readProject(ws, slug).log).toContain("2 次提交：edit chapter；first chapter");
    expect(readProject(ws, slug).log.split("<!-- sync:commits -->")).toHaveLength(2);
    expect(await git.resolveRef({ fs, dir: repo, ref: "HEAD" })).toBe(head);
    expect(files(repo)).toEqual(before);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
});
