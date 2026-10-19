// Synthetic files and real loopback HTTP only. No global fetch, Git or clock mocks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "kaitu-v5-"));
for (const [key, value] of Object.entries({
  HOME: "home",
  KAITU_APP_HOME: "app",
  KAITU_LOCAL_STATE_DIR: "state",
  XDG_STATE_HOME: "xdg",
  LOCALAPPDATA: "local",
})) {
  process.env[key] = join(root, value);
  mkdirSync(process.env[key], { recursive: true });
}
process.env.KAITU_DIR = join(root, "workspace");
const core = await import("../../../packages/core/dist/index.js");
const { startUi } = await import("../../../packages/cli/dist/ui/server.js");
const result = {
  at: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  root,
  http: [],
  syncHttp: [],
};
const ws = await core.initWorkspace(join(root, "workspace"));
const ui = await startUi(ws, { port: 0, open: false });
const call = async (name, args, raw) => {
  const payload = raw ?? JSON.stringify(args);
  const response = await fetch(`${ui.url}/api/product/${name}`, {
    method: "POST",
    headers: { Origin: ui.url, "X-Kaitu": "1", "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.json();
  const entry = { method: "POST", path: `/api/product/${name}`, payload, status: response.status, body };
  result.http.push(entry);
  return entry;
};
let remoteFiles = {};
let remoteHead = null;
let pushes = 0;
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let value;
  if (req.url === "/inspect") value = { private: true, branch: "main" };
  else if (req.url === "/read") value = { head: remoteHead, files: remoteFiles };
  else if (req.url === "/push") {
    const input = JSON.parse(raw);
    assert.equal(input.head, remoteHead);
    remoteFiles = input.files;
    remoteHead = `fixture-${++pushes}`;
    value = remoteHead;
  } else {
    res.statusCode = 404;
    value = { error: "unknown fixture route" };
  }
  const summarize = (value) =>
    value?.files
      ? { ...value, files: { count: Object.keys(value.files).length, profile: value.files["me/profile.md"] } }
      : value;
  result.syncHttp.push({
    method: req.method,
    path: req.url,
    request: raw ? summarize(JSON.parse(raw)) : null,
    response: summarize(value),
  });
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${fixture.address().port}`;
// Explicit BackupRemote transport seam, not GitHub REST acceptance.
const remoteRequest = async (path, body) =>
  (
    await fetch(`${endpoint}/${path}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined)
  ).json();
const remote = {
  inspect: () => remoteRequest("inspect"),
  read: () => remoteRequest("read"),
  push: (_r, _b, head, files) => remoteRequest("push", { head, files }),
};
try {
  const saved = await call("onboardingMatterSave", ["V5 synthetic original: learn safely."]);
  assert.equal(saved.status, 200);
  const source = saved.body.source;
  const original = ws.readText(source);
  assert.equal((await call("onboardingMatterPaste", [source, '{"goal":42,"next":[]}'])).status, 400);
  assert.equal(ws.readText(source), original);
  result.paste = { source, original, after: ws.readText(source) };
  const profile = ws.readText("me/profile.md");
  assert.equal((await call("onboardingMatterSave", [], '{"broken":')).status, 400);
  await call("onboardingMatterSave", [], "{}");
  assert.equal(ws.readText("me/profile.md"), profile);
  result.invalidRequest = { profileBefore: profile, profileAfter: ws.readText("me/profile.md") };
  const valid =
    '---\ndate: 2026-10-19\nblocks:\n  - id: v5\n    title: Synthetic proposal\n    kind: proposal\n    status: pending\n    start: "18:00"\n    end: "19:00"\n---\nRetain this body.\n';
  const broken = valid.replace("date: 2026-10-19", "date: [unterminated");
  ws.writeText("NOW.md", broken);
  assert.equal((await call("decideProposal", ["v5", "confirmed"])).status, 400);
  assert.equal(ws.readText("NOW.md"), broken);
  result.frontmatter = { before: broken, afterFailure: ws.readText("NOW.md") };
  ws.writeText("NOW.md", valid);
  assert.equal((await call("decideProposal", ["v5", "confirmed"])).status, 200);
  const repaired = ws.readText("NOW.md");
  await call("decideProposal", ["v5", "confirmed"]);
  result.frontmatter.afterRecovery = ws.readText("NOW.md");
  result.frontmatter.retryUnchanged = ws.readText("NOW.md") === repaired;
  assert.equal(result.frontmatter.retryUnchanged, true);
  await core.connectWorkspaceBackup(ws, { repo: "synthetic/v5", text: true, records: false }, remote);
  await core.syncWorkspaceBackup(ws, remote);
  ws.writeText("me/profile.md", "Local synthetic change\n");
  remoteFiles = { ...remoteFiles, "me/profile.md": "Remote synthetic change\n" };
  remoteHead = "fixture-external";
  await core.syncWorkspaceBackup(ws, remote);
  await call("workspaceBackup", ["status"]);
  ws.writeText("me/profile.md", "Local second synthetic change\n");
  const stale = await call("workspaceBackup", ["resolve", { path: "me/profile.md", choice: "remote" }]);
  assert.equal(ws.readText("me/profile.md"), "Local second synthetic change\n");
  result.conflict = {
    staleStatus: stale.status,
    before: "Local second synthetic change\n",
    afterFailure: ws.readText("me/profile.md"),
  };
  await call("workspaceBackup", ["resolve", { path: "me/profile.md", choice: "remote" }]);
  result.conflict.afterResolve = ws.readText("me/profile.md");
  const archive = ws.resolve(".kaitu/backup-conflicts", { internal: true });
  result.conflict.archives = readdirSync(archive).map((file) =>
    ws.readJson(`.kaitu/backup-conflicts/${file}`),
  );
  await call("workspaceBackup", ["resolve", { path: "me/profile.md", choice: "remote" }]);
  assert.equal(readdirSync(archive).length, 1);
  await core.syncWorkspaceBackup(ws, remote);
  const count = pushes;
  await core.syncWorkspaceBackup(ws, remote);
  assert.equal(pushes, count);
  result.conflict.pushesAfterRecovery = count;
  result.conflict.pushesAfterRetry = pushes;
  // Genuine refused TCP connection: reserve a loopback port, close it, then ask the real app to connect.
  const port = fixture.address().port;
  await new Promise((resolve) => fixture.close(resolve));
  const settingsPath = join(root, "state", "web-ai", "kaitu-ai.json");
  result.connection = { settingsExistedBefore: existsSync(settingsPath) };
  const input = {
    choice: "builtin",
    provider: "kaitu-custom",
    api: "openai-completions",
    model: "v5-synthetic",
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: "v5-synthetic-key",
  };
  assert.equal((await call("askConfigure", [input])).body.code, "AI_NETWORK");
  result.connection.settingsExistsAfterFailure = existsSync(settingsPath);
  assert.equal(result.connection.settingsExistsAfterFailure, false);
  // Restore a controlled service at the same port; only validates connection, no AI session/tool success claim.
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    result.connection.request = { path: req.url, body: JSON.parse(raw) };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
  });
  await new Promise((resolve) => model.listen(port, "127.0.0.1", resolve));
  try {
    assert.equal((await call("askConfigure", [input])).status, 200);
    assert.equal((await call("askSettings", [])).body.configured, true);
    result.connection.settingsExistsAfterRecovery = existsSync(settingsPath);
    const { apiKey, ...retry } = input;
    assert.equal((await call("askConfigure", [retry])).status, 200);
    assert.equal(result.connection.settingsExistsAfterRecovery, true);
    assert.equal(ws.readText(source), original);
  } finally {
    await new Promise((resolve) => model.close(resolve));
  }
  const draft = { goal: "V5 recovery goal", current: "Synthetic only", next: "Read one page" };
  assert.equal((await call("onboardingMatterPaste", [source, JSON.stringify(draft)])).status, 200);
  const adopted = await call("onboardingMatterAdopt", [source, draft]);
  assert.equal(adopted.status, 200);
  const tasksBefore = core.readRecords(ws, "task");
  const goalsBefore = ws.readText("me/goals.json");
  const retried = await call("onboardingMatterAdopt", [source, draft]);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.id, adopted.body.id);
  assert.deepEqual(core.readRecords(ws, "task"), tasksBefore);
  assert.equal(ws.readText("me/goals.json"), goalsBefore);
  result.paste.recovery = {
    task: adopted.body.id,
    retryTask: retried.body.id,
    tasks: tasksBefore,
    goals: JSON.parse(goalsBefore),
    text: core.readOnboardingMatter(ws, source).text,
  };
  result.icloud = "NOT TESTED: Linux; no real iCloud placeholder available.";
} finally {
  await ui.close();
  if (fixture.listening) await new Promise((resolve) => fixture.close(resolve));
  const output = process.argv[2] ?? join(root, "evidence.json");
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        root,
        output,
        http: result.http.map((x) => ({
          path: x.path,
          status: x.status,
          body: x.status >= 400 ? x.body : undefined,
        })),
      },
      null,
      2,
    ),
  );
}
