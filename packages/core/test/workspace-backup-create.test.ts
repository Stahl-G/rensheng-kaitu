import fs from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  connectWorkspaceBackup,
  disconnectWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupRequest,
  workspaceBackupStatus,
} from "../src/workspace-backup.js";
import type { WorkspaceWrite } from "../src/workspace.js";
import { clonedWorkspace, tmp } from "./helpers.js";

// Only the external gh executable is fake; creation, inspection and upload use product code.
function fakeGithub() {
  const bin = tmp();
  const watchers = new Set<fs.FSWatcher>();
  const control = join(bin, "control.json");
  const entered = join(bin, "entered");
  const release = join(bin, "release");
  const calls = join(bin, "calls.jsonl");
  fs.writeFileSync(calls, "");
  fs.writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const control = ${JSON.stringify(control)};
const entered = ${JSON.stringify(entered)};
const release = ${JSON.stringify(release)};
const calls = ${JSON.stringify(calls)};
fs.appendFileSync(calls, JSON.stringify(args) + "\\n");
const config = JSON.parse(fs.readFileSync(control, "utf8"));
const stage = args[0] === "repo" ? args[1] : args.find(a => a.startsWith("repos/"))?.split("/").length === 3 ? "inspect" : "upload";
(async () => {
  if (stage === config.stage) {
    fs.writeFileSync(entered, stage);
    while (!fs.existsSync(release)) await new Promise(r => setTimeout(r, 5));
    if (config.fail) process.exit(1);
  }
  if (stage === "view") process.exit(1);
  if (stage === "create") process.exit(0);
  const method = args[args.indexOf("--method") + 1];
  const path = args.find(a => a.startsWith("repos/"));
  const body = stage === "inspect" ? { private: true, default_branch: "main" }
    : method === "GET" ? {} : path.includes("/contents/") ? { commit: { sha: "initial", tree: { sha: "tree" } } } : { sha: "synthetic" };
  const status = method === "GET" && stage !== "inspect" ? 404 : 200;
  console.log("HTTP/2 " + status + "\\n\\n" + JSON.stringify(body));
  if (status === 404) process.exitCode = 1;
})();
`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", bin);
  return {
    block(stage: string, fail = false) {
      fs.rmSync(entered, { force: true });
      fs.rmSync(release, { force: true });
      fs.writeFileSync(control, JSON.stringify({ stage, fail }));
    },
    started: () =>
      new Promise<void>((resolve, reject) => {
        const ready = () => {
          if (!fs.existsSync(entered)) return;
          watcher.close();
          resolve();
        };
        const watcher = fs.watch(bin, ready);
        watchers.add(watcher);
        watcher.on("close", () => watchers.delete(watcher));
        watcher.on("error", reject);
        ready();
      }),
    close: () => {
      for (const watcher of watchers) watcher.close();
    },
    release: () => fs.writeFileSync(release, "go"),
    calls: () =>
      fs
        .readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}

it.skipIf(process.platform === "win32")(
  "create 期间断开或连接新仓库，迟到成功不得写 README、覆盖选择或上传",
  async () => {
    const gh = fakeGithub();
    try {
      for (const stage of ["create", "inspect"]) {
        for (const change of ["disconnect", "connect", "create", "root"]) {
          const ws = await clonedWorkspace();
          fs.rmSync(join(ws.root, "README.md"), { force: true });
          gh.block(stage);
          const pending = workspaceBackupRequest(ws, "create", {
            repo: "synthetic/old",
            text: true,
            records: false,
          });
          const result = pending.then(
            () => null,
            (error: unknown) => error,
          );
          await gh.started();
          if (change === "disconnect") disconnectWorkspaceBackup(ws);
          else if (change === "root") {
            ws.root = (await clonedWorkspace()).root;
            fs.rmSync(join(ws.root, "README.md"), { force: true });
            disconnectWorkspaceBackup(ws);
          } else if (change === "create") {
            gh.block("none");
            await workspaceBackupRequest(ws, "create", {
              repo: "synthetic/new",
              text: false,
              records: true,
            });
            await syncWorkspaceBackup(ws);
          } else
            await connectWorkspaceBackup(
              ws,
              { repo: "synthetic/new", text: false, records: true },
              {
                inspect: async () => ({ private: true, branch: "main" }),
                read: async () => {
                  throw new Error("unexpected read");
                },
                push: async () => {
                  throw new Error("unexpected upload");
                },
              },
            );
          const readme = ws.exists("README.md") ? ws.readText("README.md") : null;
          const before = ws.readText(".kaitu/workspace-backup.json");
          const callCount = gh.calls().length;
          gh.release();
          const error = await result;
          if (workspaceBackupStatus(ws).running) await syncWorkspaceBackup(ws);
          expect(error).toMatchObject({ code: "CONFLICT" });
          expect(ws.readText(".kaitu/workspace-backup.json")).toBe(before);
          expect(ws.exists("README.md") ? ws.readText("README.md") : null).toBe(readme);
          expect(
            gh
              .calls()
              .slice(callCount)
              .every((args) => !args.includes("PUT") && !args.includes("POST") && !args.includes("PATCH")),
          ).toBe(true);
        }
      }
    } finally {
      gh.close();
      vi.unstubAllEnvs();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "create 失败和排队提交失效均保留选择，正常重试能生成 README 并上传",
  async () => {
    const gh = fakeGithub();
    try {
      const ws = await clonedWorkspace();
      fs.rmSync(join(ws.root, "README.md"), { force: true });
      for (const stage of ["create", "inspect"]) {
        gh.block(stage, true);
        const pending = workspaceBackupRequest(ws, "create", {
          repo: "synthetic/fail",
          text: true,
          records: false,
        });
        const result = pending.catch((error: unknown) => error);
        await gh.started();
        disconnectWorkspaceBackup(ws);
        const before = ws.readText(".kaitu/workspace-backup.json");
        gh.release();
        expect(await result).toMatchObject({ code: "GH_REQUEST" });
        expect(ws.readText(".kaitu/workspace-backup.json")).toBe(before);
        expect(ws.exists("README.md")).toBe(false);
      }
      gh.block("none");
      const write: WorkspaceWrite = async (action) => {
        if (
          gh
            .calls()
            .at(-1)
            ?.some((arg) => arg === "repos/synthetic/queued")
        )
          disconnectWorkspaceBackup(ws);
        return action();
      };
      await expect(
        workspaceBackupRequest(ws, "create", { repo: "synthetic/queued", text: true, records: false }, write),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(ws.exists("README.md")).toBe(false);
      const committed: boolean[] = [];
      const status = await workspaceBackupRequest(
        ws,
        "create",
        {
          repo: "synthetic/retry",
          text: true,
          records: false,
        },
        async (action) => {
          const result = await action();
          if (workspaceBackupStatus(ws).connection?.repo === "synthetic/retry")
            committed.push(workspaceBackupStatus(ws).running);
          return result;
        },
      );
      expect(committed).toEqual([true]);
      expect(status).toMatchObject({ connection: { repo: "synthetic/retry", private: true, enabled: true } });
      await syncWorkspaceBackup(ws);
      expect(workspaceBackupStatus(ws).error).toBeNull();
      expect(ws.exists("README.md")).toBe(true);
      expect(
        gh
          .calls()
          .some(
            (args) => args.includes("PATCH") && args.includes("repos/synthetic/retry/git/refs/heads/main"),
          ),
      ).toBe(true);
    } finally {
      gh.close();
      vi.unstubAllEnvs();
    }
  },
);
