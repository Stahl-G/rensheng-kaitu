import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { KaituError } from "./errors.js";
import { parseGithubRepo } from "./github.js";

function executable() {
  const directories = [...(process.env.PATH ?? "").split(delimiter)];
  if (process.platform === "darwin") directories.push("/opt/homebrew/bin", "/usr/local/bin");
  return (
    directories
      .map((directory) => join(directory, process.platform === "win32" ? "gh.exe" : "gh"))
      .find((file) => existsSync(file)) ?? "gh"
  );
}

/** 不经 shell；请求正文走 stdin，凭据和 CLI 原始错误不进入开图日志。 */
function run(
  args: string[],
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ output: string; ok: boolean; loginRequired: boolean }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable(),
      args,
      { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (signal?.aborted) reject(signal.reason);
        else if (error && "code" in error && error.code === "ENOENT") {
          reject(new KaituError("请先安装 GitHub CLI，或改用单仓库 token", "GH_MISSING"));
        } else
          resolve({ output: stdout, ok: !error, loginRequired: /gh auth login|not logged/i.test(stderr) });
      },
    );
    child.stdin?.on("error", () => {
      reject(
        signal?.aborted ? signal.reason : new KaituError("GitHub 请求正文未能写入，请重试", "GH_REQUEST"),
      );
    });
    child.stdin?.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export async function githubCliStatus() {
  try {
    const auth = await run(["auth", "status", "--hostname", "github.com"]);
    if (!auth.ok) return { installed: true, authenticated: false, login: null };
    const user = await run(["api", "--hostname", "github.com", "user", "--jq", ".login"]);
    const login = user.ok && /^[\w-]+$/.test(user.output.trim()) ? user.output.trim() : null;
    return { installed: true, authenticated: !!login, login };
  } catch (error) {
    if (error instanceof KaituError && error.code === "GH_MISSING")
      return { installed: false, authenticated: false, login: null };
    throw error;
  }
}

export async function githubCliRequest(
  repo: string,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    "--include",
    "--method",
    method,
    `repos/${parseGithubRepo(repo)}${path}`,
  ];
  if (body !== undefined) args.push("--input", "-");
  const { output, ok, loginRequired } = await run(args, body, signal);
  const status = Number(/^HTTP\/\S+\s+(\d+)/m.exec(output)?.[1]);
  if ([404, 409].includes(status) && path.startsWith("/git/ref/")) return null;
  if (!ok || status >= 400)
    throw new KaituError(
      status === 401 || loginRequired
        ? "GitHub 登录已失效，请在 GitHub CLI 中重新登录后重试"
        : "GitHub 请求失败，请检查现有 gh 登录、仓库权限或网络后重试",
      "GH_REQUEST",
    );
  const separator = /\r?\n\r?\n/.exec(output);
  const text = separator ? output.slice((separator.index ?? 0) + separator[0].length) : output;
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new KaituError("GitHub 返回的数据无法读取，请重试", "GH_REQUEST");
  }
}

export const memoryRepositoryDescription = "开图个人记忆与项目进度；Agent 请先读 AGENT-README.md";

export async function createPrivateGithubRepository(repo: string) {
  const name = parseGithubRepo(repo);
  const existing = await run(["repo", "view", name, "--json", "nameWithOwner"]);
  if (existing.loginRequired) throw new KaituError("GitHub 登录已失效，请重新登录后重试", "GH_REQUEST");
  if (existing.ok) throw new KaituError(`仓库 ${name} 已存在，请用「连接已有仓库」`, "GH_REQUEST");
  const result = await run([
    "repo",
    "create",
    "--private",
    "--description",
    memoryRepositoryDescription,
    "--",
    name,
  ]);
  if (!result.ok) throw new KaituError("未能创建私有仓库", "GH_REQUEST");
  return name;
}

let login: { pending: boolean; code?: string; error?: string } = { pending: false };
let loginChild: ReturnType<typeof execFile> | undefined;
export function githubCliLoginState() {
  return login;
}
export function beginGithubCliLogin(notify: () => void) {
  if (login.pending) return login;
  login = { pending: true };
  const child = execFile(
    executable(),
    ["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https", "--skip-ssh-key"],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
    (error) => {
      if (loginChild !== child) return;
      login = {
        pending: false,
        ...(error ? { error: "GitHub 登录未完成，可以重试或使用单仓库 token" } : {}),
      };
      loginChild = undefined;
      notify();
    },
  );
  loginChild = child;
  // 拒绝替用户改 Git 全局凭据配置；授权由 GitHub 官方页面完成。
  loginChild.stdin?.end("n\n");
  let output = "";
  loginChild.stderr?.on("data", (chunk) => {
    if (loginChild !== child) return;
    output = (output + String(chunk)).slice(-2000);
    const code = /code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(output)?.[1];
    if (code && code !== login.code) {
      login = { pending: true, code };
      notify();
    }
  });
  return login;
}
export function cancelGithubCliLogin() {
  loginChild?.kill();
  loginChild = undefined;
  login = { pending: false };
  return login;
}
