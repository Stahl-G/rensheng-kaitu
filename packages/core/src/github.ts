import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { stringifyFrontmatter } from "./frontmatter.js";
import type { ModuleDef } from "./modules.js";
import { batchOverview } from "./overview.js";
import { appendLog, metricStore, projectVersion, readProject } from "./projects.js";
import { type StoredRecord, addRecord, readRecords, updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { isoInZone, localDate, parseTs } from "./time.js";
import type { Workspace } from "./workspace.js";

export type GithubProblem = "gone_or_forbidden" | "rate_limited" | "network" | "archived" | "renamed" | null;
export interface GithubSnapshot extends StoredRecord {
  project: string;
  repo: string;
  stars: number;
  forks: number;
  open_issues: number;
  open_prs: number;
  default_branch: string;
  archived: boolean;
  pushed_at: string | null;
  latest_release: { tag: string; name: string; published_at: string; url: string } | null;
  commits: { sha: string; title: string; date: string }[];
  ci: {
    state: "success" | "failure" | "running" | "none" | "no_access";
    run_at: string | null;
    url: string | null;
  };
}
interface RepoState {
  checked_at: string;
  ok_at: string | null;
  error: string | null;
  problem: GithubProblem;
}
interface GithubState {
  etags: Record<string, { etag: string; body: unknown; status: number; link: string | null }>;
  rate: { remaining: number | null; reset: number | null; blocked_until: number | null };
  repos: Record<string, RepoState>;
}
interface Repo {
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  archived: boolean;
  pushed_at: string | null;
}
interface Commit {
  sha: string;
  commit: { message: string; committer: { date: string } };
}
interface Release {
  tag_name: string;
  name: string | null;
  published_at: string;
  html_url: string;
}
interface Runs {
  total_count: number;
  workflow_runs: {
    status: string;
    conclusion: string | null;
    run_started_at?: string;
    created_at: string;
    html_url: string;
  }[];
}
interface GithubOptions {
  now?: Date;
  api?: string;
  fetch?: typeof fetch;
}
const stateFile = ".kaitu/github-state.json";
const secretsFile = ".kaitu/secrets.json";

export function parseGithubRepo(input: string): string {
  let value = input.trim();
  if (value.startsWith("git@github.com:")) value = value.slice(15);
  else if (/^(?:https:\/\/)?github\.com\//i.test(value)) {
    value = value.replace(/^(?:https:\/\/)?github\.com\//i, "");
    value = value.replace(/\/tree\/.+$/, "");
  }
  value = value.replace(/\/$/, "").replace(/\.git$/, "");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new KaituError("GitHub 仓库地址不合法", "BAD_ARGS");
  }
  return value;
}
function secrets(ws: Workspace) {
  const value = ws.exists(secretsFile) ? ws.readJson<Record<string, unknown>>(secretsFile) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KaituError("密钥文件格式不合法", "INVALID_SECRETS");
  }
  return value;
}
export function setGithubToken(ws: Workspace, token: string | null): void {
  const value = secrets(ws);
  if (token === null) value.github_token = undefined;
  else {
    if (!token.trim() || /\s/.test(token.trim())) throw new KaituError("GitHub token 不合法", "BAD_ARGS");
    value.github_token = token.trim();
  }
  ws.writeJson(secretsFile, value, { internal: true, mode: 0o600 });
  chmodSync(ws.resolve(secretsFile, { internal: true }), 0o600);
  // 换凭据后重新核验权限与额度。
  if (ws.exists(stateFile)) {
    const state = readState(ws);
    state.etags = {};
    state.rate = { remaining: null, reset: null, blocked_until: null };
    ws.writeJson(stateFile, state, { internal: true });
  }
}
function readState(ws: Workspace): GithubState {
  return ws.exists(stateFile)
    ? ws.readJson<GithubState>(stateFile)
    : {
        etags: {},
        rate: { remaining: null, reset: null, blocked_until: null },
        repos: {},
      };
}
class GithubFailure extends KaituError {
  constructor(
    message: string,
    readonly problem: GithubProblem,
  ) {
    super(message, "GITHUB_SYNC");
  }
}
function requester(ws: Workspace, state: GithubState, options: GithubOptions, now: Date) {
  const token = secrets(ws).github_token;
  const api = (options.api ?? process.env.KAITU_GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");
  return async <T>(path: string, allowed: number[] = []) => {
    const seconds = now.getTime() / 1000;
    if ((state.rate.blocked_until ?? 0) > seconds)
      throw new GithubFailure("GitHub 请求限流，请稍后同步", "rate_limited");
    const url = `${api}${path}`;
    const cached = state.etags[url];
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kaitu",
      ...(typeof token === "string" && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cached ? { "If-None-Match": cached.etag } : {}),
    };
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, { headers });
    } catch {
      throw new GithubFailure("无法连接 GitHub", "network");
    }
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining !== null && Number.isFinite(Number(remaining))) state.rate.remaining = Number(remaining);
    if (reset !== null && Number.isFinite(Number(reset))) state.rate.reset = Number(reset);
    const retry = response.headers.get("retry-after");
    const limited = [403, 429].includes(response.status) && (remaining === "0" || retry !== null);
    if (limited || (remaining === "0" && state.rate.reset !== null)) {
      const retryAt =
        retry === null
          ? null
          : Number.isFinite(Number(retry))
            ? seconds + Number(retry)
            : Date.parse(retry) / 1000;
      state.rate.blocked_until = Math.max(
        seconds,
        state.rate.reset ?? 0,
        Number.isFinite(retryAt) ? (retryAt ?? 0) : 0,
      );
    }
    if (limited) throw new GithubFailure("GitHub 请求限流，请稍后同步", "rate_limited");
    let status = response.status;
    let body: unknown;
    let link = response.headers.get("link");
    if (status === 304 && cached) {
      ({ status, body } = cached);
      link ??= cached.link;
    } else {
      if (!response.ok && !allowed.includes(status)) {
        throw new GithubFailure(
          [401, 403, 404].includes(status) ? "找不到仓库或没有权限" : `GitHub 请求失败（HTTP ${status}）`,
          [401, 403, 404].includes(status) ? "gone_or_forbidden" : "network",
        );
      }
      try {
        body = response.ok ? await response.json() : null;
      } catch {
        throw new GithubFailure("GitHub 返回的数据不合法", "network");
      }
      const etag = response.headers.get("etag");
      if (etag) state.etags[url] = { etag, body, status, link };
      else Reflect.deleteProperty(state.etags, url);
    }
    return { body: body as T, status, link };
  };
}
function snapshots(ws: Workspace, slug: string, now: Date): GithubSnapshot[] {
  const store = metricStore(ws, readProject(ws, slug).data, true);
  if (
    !store.exists("projects/module.json") ||
    !store.readJson<ModuleDef>("projects/module.json").records?.github_snapshot
  )
    return [];
  return readRecords(store, "github_snapshot").filter(
    (r) => r.project === slug && parseTs(r.ts) <= now,
  ) as GithubSnapshot[];
}
function bindRepo(ws: Workspace, slug: string, repo: string, now: Date) {
  const project = readProject(ws, slug);
  project.data.github = { repo };
  project.data.updated = isoInZone(now, ws.timeZone());
  ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(project.data, project.body), {
    internal: true,
  });
}
export async function bindGithub(ws: Workspace, slug: string, url: string, options: GithubOptions = {}) {
  readProject(ws, slug);
  const repo = parseGithubRepo(url);
  const now = options.now ?? new Date();
  const state = readState(ws);
  let canonical: string;
  try {
    const result = await requester(ws, state, options, now)<Repo>(`/repos/${repo}`);
    canonical = parseGithubRepo(result.body.full_name);
  } finally {
    ws.writeJson(stateFile, state, { internal: true });
  }
  return batchOverview(ws, async () => {
    bindRepo(ws, slug, canonical, now);
    return syncGithub(ws, slug, options);
  });
}
export async function syncGithub(ws: Workspace, slug: string, options: GithubOptions = {}) {
  return batchOverview(ws, async () => {
    const project = readProject(ws, slug);
    let repo = project.data.github?.repo;
    if (!repo) throw new KaituError("项目未绑定 GitHub 仓库", "BAD_ARGS");
    const now = options.now ?? new Date();
    const state = readState(ws);
    const checked_at = isoInZone(now, ws.timeZone());
    const previousState = state.repos[slug];
    let problem: GithubProblem = null;
    try {
      const request = requester(ws, state, options, now);
      const info = (await request<Repo>(`/repos/${repo}`)).body;
      const canonical = parseGithubRepo(info.full_name);
      if (canonical !== repo) problem = "renamed";
      repo = canonical;
      if (info.archived) problem = "archived";
      const base = `/repos/${repo}`;
      const pulls = await request<unknown[]>(`${base}/pulls?state=open&per_page=1`);
      const last = pulls.link
        ?.split(",")
        .find((part) => /rel="last"/.test(part))
        ?.match(/<([^>]+)>/);
      const open_prs = last ? Number(new URL(last[1] as string).searchParams.get("page")) : pulls.body.length;
      const commits = (
        await request<Commit[]>(`${base}/commits?sha=${encodeURIComponent(info.default_branch)}&per_page=10`)
      ).body;
      const release = await request<Release | null>(`${base}/releases/latest`, [404]);
      const runs = await request<Runs>(
        `${base}/actions/runs?branch=${encodeURIComponent(info.default_branch)}&per_page=1`,
        [401, 403, 404],
      );
      const run = runs.body?.workflow_runs?.[0];
      const ci: GithubSnapshot["ci"] =
        runs.status !== 200
          ? { state: "no_access", run_at: null, url: null }
          : runs.body.total_count === 0
            ? { state: "none", run_at: null, url: null }
            : {
                state:
                  run?.status !== "completed"
                    ? "running"
                    : run.conclusion === "success"
                      ? "success"
                      : "failure",
                run_at: run?.run_started_at ?? run?.created_at ?? null,
                url: run?.html_url ?? null,
              };
      const data = {
        project: slug,
        repo,
        stars: info.stargazers_count,
        forks: info.forks_count,
        open_issues: Math.max(0, info.open_issues_count - open_prs),
        open_prs,
        default_branch: info.default_branch,
        archived: info.archived,
        pushed_at: info.pushed_at,
        latest_release:
          release.status === 404 || !release.body
            ? null
            : {
                tag: release.body.tag_name,
                name: release.body.name ?? release.body.tag_name,
                published_at: release.body.published_at,
                url: release.body.html_url,
              },
        commits: commits.slice(0, 10).map((item) => ({
          sha: item.sha.slice(0, 7),
          title: [...(item.commit.message.split(/\r?\n/)[0] ?? "")].slice(0, 80).join(""),
          date: item.commit.committer.date,
        })),
        ci,
      };
      if (
        !schemas().builtin("github-snapshot.schema.json")({
          ...data,
          id: "00000000000000000000000000",
          ts: checked_at,
          by: "agent",
        })
      ) {
        throw new GithubFailure("GitHub 返回的数据不合法", "network");
      }
      const existing = snapshots(ws, slug, now);
      const today = localDate(now, ws.timeZone());
      const current = existing.find((r) => localDate(parseTs(r.ts), ws.timeZone()) === today);
      const same =
        current &&
        Object.entries(data).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
      let record = current ?? null;
      if (!same) {
        const store = metricStore(ws, project.data);
        const module = store.readJson<ModuleDef>("projects/module.json");
        if (!module.records?.github_snapshot) {
          const template: ModuleDef = JSON.parse(
            readFileSync(join(templateDir(), "projects/module.json"), "utf8"),
          );
          module.records = {
            ...module.records,
            github_snapshot: template.records?.github_snapshot as NonNullable<ModuleDef["records"]>[string],
          };
          store.writeJson("projects/module.json", module);
        }
        record = (
          current
            ? updateRecord(store, "github_snapshot", current.id, { ...data, ts: checked_at })
            : addRecord(store, "github_snapshot", data, { now })
        ).record as GithubSnapshot;
        const previous = existing.filter((r) => localDate(parseTs(r.ts), ws.timeZone()) < today).at(-1);
        const delta = previous ? data.stars - previous.stars : null;
        const change = delta === null ? "首次记录" : `净变化 ${delta >= 0 ? "+" : ""}${delta}`;
        appendLog(
          ws,
          slug,
          `GitHub：Star ${data.stars}（${change}），Fork ${data.forks}，开放 Issue ${data.open_issues}、PR ${data.open_prs}`,
          today,
          "github",
        );
        if (data.latest_release && data.latest_release.tag !== existing.at(-1)?.latest_release?.tag) {
          appendLog(
            ws,
            slug,
            `GitHub 发布：${data.latest_release.tag} ${data.latest_release.name}`,
            today,
            "github-release",
          );
        }
      }
      const renamed = project.data.github?.repo !== repo;
      if (renamed) {
        bindRepo(ws, slug, repo, now);
        appendLog(
          ws,
          slug,
          `GitHub 仓库改名：${project.data.github?.repo} → ${repo}`,
          today,
          "github-rename",
        );
      }
      state.repos[slug] = { checked_at, ok_at: checked_at, error: null, problem };
      ws.writeJson(stateFile, state, { internal: true });
      return {
        slug,
        repo,
        ok: true,
        problem,
        snapshot: record,
        version:
          same && !renamed
            ? null
            : await projectVersion(ws, slug, `同步了 GitHub：${project.data.title}`, now),
      };
    } catch (error) {
      problem = error instanceof GithubFailure ? error.problem : "network";
      state.repos[slug] = {
        checked_at,
        ok_at: previousState?.ok_at ?? null,
        problem,
        error: error instanceof KaituError ? error.message : "GitHub 同步失败",
      };
      ws.writeJson(stateFile, state, { internal: true });
      return { slug, repo, ok: false, problem, snapshot: null, version: null };
    }
  });
}
export function projectGithub(ws: Workspace, slug: string, now = new Date()) {
  const repo = readProject(ws, slug).data.github?.repo;
  if (!repo) return null;
  const rows = snapshots(ws, slug, now);
  const latest = rows.at(-1) ?? null;
  const state = readState(ws).repos[slug];
  return {
    repo,
    url: `https://github.com/${repo}`,
    latest,
    ok_at: state?.ok_at ?? null,
    checked_at: state?.checked_at ?? null,
    stale:
      !latest ||
      !!state?.error ||
      (!!state?.checked_at && (!state.ok_at || Date.parse(state.checked_at) > Date.parse(state.ok_at))) ||
      now.getTime() - Date.parse(latest.ts) > 48 * 3600000,
    problem: state?.problem ?? null,
    error: state?.error ?? null,
    since: rows[0] ? localDate(parseTs(rows[0].ts), ws.timeZone()) : null,
    history: rows.map((row) => ({
      date: localDate(parseTs(row.ts), ws.timeZone()),
      stars: row.stars,
      forks: row.forks,
      open_issues: row.open_issues,
      open_prs: row.open_prs,
    })),
  };
}
