import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
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

it("同步修正日志日期倒序、同日标题去重，保留计数与原仓库", async () => {
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
    for (const [index, title] of ["edit chapter", "edit chapter"].entries()) {
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
    const objectReads = vi.spyOn(fs.promises, "readFile");
    const head = await git.resolveRef({ fs, dir: repo, ref: "HEAD" });
    const { slug } = await createProject(ws, {
      title: "synthetic-code",
      kind: "work",
      links: [{ path: repo, role: "repo" }],
    });
    const sections = ["2026-10-11", "2026-10-10", "2026-10-09", "2026-10-14"].map(
      (date) => `## ${date}\n\n- 手写 ${date}\n`,
    );
    ws.writeText(`projects/${slug}/log.md`, `# 项目进展\n\n${sections.join("\n")}`);
    objectReads.mockClear();
    expect((await syncProject(ws, slug, { now: new Date("2026-10-14T05:00:00Z") })).metrics).toEqual([]);
    const commitsRead = objectReads.mock.calls.filter(([file]) =>
      String(file).replaceAll("\\", "/").startsWith(join(repo, ".git/objects/").replaceAll("\\", "/")),
    );
    expect(commitsRead).toHaveLength(3);
    objectReads.mockRestore();
    expect(readProject(ws, slug).log).toBe(
      `# 项目进展\n\n${[...sections].sort((a, b) => b.localeCompare(a)).join("\n")}`,
    );
    await syncProject(ws, slug, { now: new Date("2026-10-15T05:00:00Z") });
    await syncProject(ws, slug, { now: new Date("2026-10-15T06:00:00Z") });
    expect(
      readRecords(ws, "project_metric").map((r) => ({ kind: r.kind, value: r.value, detail: r.detail })),
    ).toEqual([{ kind: "commits", value: 2, detail: ["edit chapter"] }]);
    expect(readProject(ws, slug).log).toContain("2 次提交：edit chapter");
    const log = readProject(ws, slug).log;
    expect([...log.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      "2026-10-14",
      "2026-10-11",
      "2026-10-10",
      "2026-10-09",
    ]);
    for (const section of sections) expect(log).toContain(section.trimEnd());
    expect(log.split("edit chapter")).toHaveLength(2);
    expect(log.split("<!-- sync:commits -->")).toHaveLength(2);
    expect(await git.resolveRef({ fs, dir: repo, ref: "HEAD" })).toBe(head);
    expect(files(repo)).toEqual(before);
    const shallow = join(tmp(), "shallow");
    execFileSync("git", ["clone", "--depth", "1", "--branch", "work-0", pathToFileURL(repo).href, shallow], {
      stdio: "pipe",
    });
    const shallowHead = await git.resolveRef({ fs, dir: shallow, ref: "HEAD" });
    const parent = (await git.readCommit({ fs, dir: shallow, oid: shallowHead })).commit.parent[0];
    expect(parent).toBeTruthy();
    await expect(git.readCommit({ fs, dir: shallow, oid: parent as string })).rejects.toThrow();
    const linked = await createProject(ws, {
      title: "synthetic-shallow-and-full",
      kind: "work",
      links: [
        { path: shallow, role: "repo" },
        { path: repo, role: "repo" },
      ],
    });
    const shallowResult = await syncProject(ws, linked.slug, { now: new Date("2026-10-15T06:00:00Z") });
    expect(shallowResult.issues).toEqual([]);
    expect(
      readRecords(ws, "project_metric")
        .filter((row) => row.project === linked.slug)
        .map((row) => row.value),
    ).toEqual([2]);
    expect(fs.readFileSync(join(shallow, ".git/shallow"), "utf8").trim()).toBe(shallowHead);
    fs.rmSync(shallow, { recursive: true, force: true });
  } finally {
    vi.restoreAllMocks();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
});

it("项目阶段认常见写法、没写补进行中，写了却认不出的报格式错误", async () => {
  const ws = await freshWorkspace();
  ws.writeText("projects/novel/STATUS.md", "---\ntitle: 小说\nstage: completed\n---\n");
  ws.writeText("projects/garden/STATUS.md", "---\ntitle: 花园\n---\n");
  ws.writeText("projects/typo/STATUS.md", "---\ntitle: 错字\nstage: donee\n---\n");
  expect(readProject(ws, "novel").data.stage).toBe("done");
  expect(readProject(ws, "garden").data.stage).toBe("active");
  expect(() => readProject(ws, "typo")).toThrow(/项目状态格式不合法/);
  // 类型同理：认得出的换成规范值，写错的报格式错误，不悄悄改成个人
  ws.writeText("projects/job/STATUS.md", "---\ntitle: 上班\nkind: 工作\n---\n");
  ws.writeText("projects/biz/STATUS.md", "---\ntitle: 生意\nkind: business\n---\n");
  expect(readProject(ws, "job").data.kind).toBe("work");
  expect(() => readProject(ws, "biz")).toThrow(/项目状态格式不合法/);
});
