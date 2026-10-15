import fs from "node:fs";
import { type IncomingHttpHeaders, createServer } from "node:http";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import { afterEach, expect, it, vi } from "vitest";
import {
  Workspace,
  bindGithub,
  createProject,
  historyDirectory,
  listProjects,
  mcpToken,
  parseGithubRepo,
  projectGithub,
  readProject,
  readRecords,
  relocateProjects,
  setGithubToken,
  setProject,
  stringifyFrontmatter,
  syncGithub,
  syncProject,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const at = (day: number, hour = 4) => new Date(`2026-10-${day}T${String(hour).padStart(2, "0")}:00:00Z`);
async function fixture(local_only = false) {
  const ws = await freshWorkspace();
  cleanups.push(() => fs.rmSync(dirname(ws.root), { recursive: true, force: true }));
  const { slug } = await createProject(ws, { title: "demo", kind: "personal", local_only });
  const requests: { url: string; headers: IncomingHttpHeaders }[] = [];
  const data = {
    repo: {
      full_name: "Owner/demo",
      stargazers_count: 120,
      forks_count: 8,
      open_issues_count: 9,
      default_branch: "main/dev",
      archived: false,
      pushed_at: at(15).toISOString(),
    },
    release: null as null | { tag_name: string; name: string; published_at: string; html_url: string },
    ciStatus: 200,
    count: 1,
    status: "completed",
    conclusion: "success",
    failPath: "",
    failStatus: 500,
    failHeaders: {} as Record<string, string>,
    network: false,
    cached: false,
    link: true,
  };
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push({ url, headers: req.headers });
    if (data.network) {
      res.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (data.failPath && url.includes(data.failPath)) {
      res.writeHead(data.failStatus, data.failHeaders).end("{}");
      return;
    }
    if (data.cached && req.headers["if-none-match"]) {
      res.writeHead(304).end();
      return;
    }
    res.setHeader("etag", '"fixture"');
    let body: unknown;
    if (url.includes("/pulls?")) {
      body = [{}];
      if (data.link)
        res.setHeader("link", '<http://127.0.0.1/pulls?state=open&per_page=1&page=4>; rel="last"');
    } else if (url.includes("/commits?")) {
      body = Array.from({ length: 12 }, () => ({
        sha: "abcdef0123456789",
        commit: {
          message: `${"星".repeat(90)}\n正文`,
          committer: { date: at(15).toISOString() },
        },
      }));
    } else if (url.endsWith("/releases/latest")) {
      body = data.release;
      if (!body) res.statusCode = 404;
    } else if (url.includes("/actions/runs?")) {
      res.statusCode = data.ciStatus;
      body = {
        total_count: data.count,
        workflow_runs: data.count
          ? [
              {
                status: data.status,
                conclusion: data.conclusion,
                created_at: at(15).toISOString(),
                html_url: "https://github.com/Owner/demo/actions/runs/1",
              },
            ]
          : [],
      };
    } else body = data.repo;
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无监听端口");
  const api = `http://127.0.0.1:${address.port}`;
  return { ws, slug, data, requests, api };
}

it("解析、核验、分页和条件缓存，同日只修订一条，按真实日期记录净下降", async () => {
  for (const input of [
    "https://github.com/Owner/demo",
    "https://github.com/Owner/demo.git",
    "github.com/Owner/demo/tree/dev/x",
    "git@github.com:Owner/demo.git",
    "Owner/demo",
  ]) {
    expect(parseGithubRepo(input)).toBe("Owner/demo");
  }
  for (const input of ["https://example.com/o/r", "o/r/issues", "o", "o/r?token=secret"]) {
    expect(() => parseGithubRepo(input)).toThrow();
  }
  const { ws, slug, data, requests, api } = await fixture();
  const mcp = mcpToken(ws);
  setGithubToken(ws, "synthetic-token");
  const first = await bindGithub(ws, slug, "owner/demo.git", { api, now: at(15) });
  expect(first.ok).toBe(true);
  expect(first.snapshot).toMatchObject({
    stars: 120,
    forks: 8,
    open_issues: 5,
    open_prs: 4,
    latest_release: null,
  });
  expect(first.snapshot?.commits).toHaveLength(10);
  expect(first.snapshot?.commits[0]).toMatchObject({ sha: "abcdef0", title: "星".repeat(80) });
  expect(requests.some((r) => r.url.includes("sha=main%2Fdev"))).toBe(true);
  expect(requests[0]?.headers).toMatchObject({
    authorization: "Bearer synthetic-token",
    "user-agent": "kaitu",
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  });
  const file = "projects/data/github/2026-10.jsonl";
  const original = ws.readText(file);
  const log = readProject(ws, slug).log;
  data.cached = true;
  const repeated = await syncGithub(ws, slug, { api, now: at(15, 5) });
  expect(repeated.snapshot?.open_prs).toBe(4);
  expect(repeated.version).toBeNull();
  expect(ws.readText(file)).toBe(original);
  expect(readProject(ws, slug).log).toBe(log);
  expect(projectGithub(ws, slug, at(15, 5))?.ok_at).toBe("2026-10-15T13:00:00+08:00");
  data.cached = false;
  data.repo.stargazers_count = 123;
  await syncGithub(ws, slug, { api, now: at(15, 6) });
  expect(readRecords(ws, "github_snapshot")).toMatchObject([{ rev: 2, stars: 123 }]);
  data.repo.stargazers_count = 119;
  await syncGithub(ws, slug, { api, now: at(17) });
  expect(projectGithub(ws, slug, at(17))?.history.map((r) => [r.date, r.stars])).toEqual([
    ["2026-10-15", 123],
    ["2026-10-17", 119],
  ]);
  expect(readProject(ws, slug).log).toContain("净变化 -4");
  expect(projectGithub(ws, slug, at(20))?.stale).toBe(true);
  expect(listProjects(ws)[0]?.completion).toBeNull();
  await setProject(ws, slug, {
    next: [
      { id: "a", title: "a", status: "done" },
      { id: "b", title: "b", status: "todo" },
      { id: "c", title: "c", status: "proposed" },
      { id: "d", title: "d", status: "skipped" },
    ],
  });
  expect(listProjects(ws)[0]?.completion).toEqual({ done: 1, total: 2, basis: "tasks" });
  const project = readProject(ws, slug);
  project.data.progress = { label: "稿件", current: 6, target: 10 };
  ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(project.data, project.body));
  expect(listProjects(ws)[0]?.completion).toEqual({ done: 6, total: 10, basis: "progress" });
  const tracked = await git.listFiles({ fs, dir: ws.root, gitdir: historyDirectory(ws), ref: "HEAD" });
  expect(tracked).not.toContain(".kaitu/github-state.json");
  expect(tracked).not.toContain(".kaitu/secrets.json");
  expect(fs.statSync(ws.resolve(".kaitu/secrets.json", { internal: true })).mode & 0o777).toBe(0o600);
  setGithubToken(ws, null);
  expect(ws.readJson(".kaitu/secrets.json")).toEqual({ mcp_token: mcp });
});

it("权限、网络、部分响应失败与两种限流都保留最后有效快照并退避", async () => {
  const { ws, slug, data, requests, api } = await fixture();
  data.failPath = "/repos/";
  for (const status of [401, 403, 404]) {
    data.failStatus = status;
    await expect(bindGithub(ws, slug, "Owner/demo", { api, now: at(15) })).rejects.toThrow(
      "找不到仓库或没有权限",
    );
    expect(projectGithub(ws, slug)).toBeNull();
  }
  data.failPath = "";
  await bindGithub(ws, slug, "Owner/demo", { api, now: at(15) });
  const original = ws.readText("projects/data/github/2026-10.jsonl");
  for (const status of [401, 403, 404]) {
    data.failPath = "/repos/";
    data.failStatus = status;
    expect((await syncGithub(ws, slug, { api, now: at(16) })).problem).toBe("gone_or_forbidden");
    expect(projectGithub(ws, slug, at(16))).toMatchObject({ stale: true, latest: { stars: 120 } });
  }
  data.failPath = "/commits?";
  data.failStatus = 500;
  expect((await syncGithub(ws, slug, { api, now: at(16) })).ok).toBe(false);
  data.failPath = "";
  data.network = true;
  expect((await syncGithub(ws, slug, { api, now: at(16) })).problem).toBe("network");
  data.network = false;
  for (const [status, headers] of [
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(at(17).getTime() / 1000) }],
    [429, { "retry-after": "120" }],
  ] as const) {
    setGithubToken(ws, null);
    data.failPath = "/repos/";
    data.failStatus = status;
    data.failHeaders = headers;
    expect((await syncGithub(ws, slug, { api, now: at(16) })).problem).toBe("rate_limited");
    const count = requests.length;
    expect((await syncGithub(ws, slug, { api, now: at(16) })).problem).toBe("rate_limited");
    expect(requests).toHaveLength(count);
  }
  expect(ws.readText("projects/data/github/2026-10.jsonl")).toBe(original);
  data.failPath = "";
  expect((await syncGithub(ws, slug, { api, now: at(18) })).ok).toBe(true);
  expect(projectGithub(ws, slug, at(18))?.stale).toBe(false);
});

it("区分 CI 未配置、无权限、运行中与各种完成结论，没有分页头时使用实际数组长度", async () => {
  const { ws, slug, data, api } = await fixture();
  data.link = false;
  await bindGithub(ws, slug, "Owner/demo", { api, now: at(15) });
  for (const [status, count, running, conclusion, expected] of [
    [200, 0, "completed", "success", "none"],
    [401, 1, "completed", "success", "no_access"],
    [403, 1, "completed", "success", "no_access"],
    [404, 1, "completed", "success", "no_access"],
    [200, 1, "in_progress", "", "running"],
    [200, 1, "completed", "failure", "failure"],
    [200, 1, "completed", "timed_out", "failure"],
    [200, 1, "completed", "cancelled", "failure"],
    [200, 1, "completed", "startup_failure", "failure"],
    [200, 1, "completed", "success", "success"],
  ] as const) {
    Object.assign(data, { ciStatus: status, count, status: running, conclusion });
    const result = await syncGithub(ws, slug, { api, now: at(15, 5) });
    expect(result.ok).toBe(true);
    expect(result.snapshot).toMatchObject({ ci: { state: expected }, open_prs: 1, open_issues: 8 });
  }
  expect(readRecords(ws, "github_snapshot")).toHaveLength(1);
});

it("识别改名、归档与新发布，项目同步自动抓取且只保存一个版本", async () => {
  const { ws, slug, data, api } = await fixture();
  await bindGithub(ws, slug, "Owner/demo", { api, now: at(15) });
  data.repo.full_name = "Owner/renamed";
  data.release = {
    tag_name: "v1",
    name: "first",
    published_at: at(16).toISOString(),
    html_url: "https://github.com/Owner/renamed/releases/v1",
  };
  vi.stubEnv("KAITU_GITHUB_API", api);
  const before = (await git.log({ fs, dir: ws.root, gitdir: historyDirectory(ws) })).length;
  const result = await syncProject(ws, slug, { now: at(16) });
  expect(result.issues).toMatchObject([{ message: "renamed" }]);
  expect(readProject(ws, slug).data.github?.repo).toBe("Owner/renamed");
  expect(readProject(ws, slug).log).toContain("Owner/demo → Owner/renamed");
  expect((await git.log({ fs, dir: ws.root, gitdir: historyDirectory(ws) })).length).toBe(before + 1);
  data.repo.archived = true;
  expect((await syncGithub(ws, slug, { api, now: at(16, 5) })).problem).toBe("archived");
  data.release.tag_name = "v2";
  await syncGithub(ws, slug, { api, now: at(16, 6) });
  const log = readProject(ws, slug).log;
  await syncGithub(ws, slug, { api, now: at(16, 7) });
  expect(readProject(ws, slug).log).toBe(log);
  expect(log.match(/sync:github-release/g)).toHaveLength(1);
  expect(projectGithub(ws, slug, at(16, 7))?.latest?.latest_release?.tag).toBe("v2");
});

it("Drive 的本机项目补齐旧模块并将快照、凭据和状态留本机，切换时搬迁所有修订", async () => {
  const { ws, slug, api } = await fixture(true);
  const stateDir = join(dirname(ws.root), "state");
  const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
  ws.writeJson(".kaitu/config.json", { ...config, state_dir: stateDir }, { internal: true });
  relocateProjects(ws, true);
  const store = new Workspace(join(stateDir, "local-projects"), { maintain: false });
  const module = store.readJson<{ records: Record<string, unknown> }>("projects/module.json");
  Reflect.deleteProperty(module.records, "github_snapshot");
  store.writeJson("projects/module.json", module);
  const original = store.readText("projects/module.json");
  expect(projectGithub(ws, slug)).toBeNull();
  expect(store.readText("projects/module.json")).toBe(original);
  setGithubToken(ws, "synthetic-private-token");
  await bindGithub(ws, slug, "Owner/demo", { api, now: at(15) });
  expect(store.readJson<{ records: object }>("projects/module.json").records).toHaveProperty(
    "github_snapshot",
  );
  expect(readRecords(store, "github_snapshot")).toMatchObject([{ project: slug, stars: 120 }]);
  expect(ws.exists("projects/data/github/2026-10.jsonl")).toBe(false);
  expect(fs.existsSync(join(ws.root, ".kaitu/github-state.json"))).toBe(false);
  expect(fs.existsSync(join(stateDir, "github-state.json"))).toBe(true);
  expect(listProjects(ws, { publicOnly: true })).toEqual([]);
  expect(listProjects(ws, { now: at(15) })[0]?.github?.latest?.stars).toBe(120);
  await setProject(ws, slug, { local_only: false });
  expect(readRecords(ws, "github_snapshot")).toHaveLength(1);
  await setProject(ws, slug, { local_only: true });
  expect(readRecords(ws, "github_snapshot")).toEqual([]);
  expect(readRecords(store, "github_snapshot")).toHaveLength(1);
});
