// 使用真实 gh、只连暂停的 loopback 代理；所有授权配置均为临时合成值。
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";

const project = resolve(import.meta.dirname, "../../..");
let pendingAtAbort = 0;
const execute = childProcess.execFile;
childProcess.execFile = (...args) => {
  const child = execute(...args);
  args[2]?.signal?.addEventListener(
    "abort",
    () => {
      pendingAtAbort = child.stdin?.writableLength ?? 0;
    },
    { once: true },
  );
  return child;
};
syncBuiltinESMExports();
const { githubCliRequest } = await import(`${project}/packages/core/dist/github-cli.js`);
const temp = mkdtempSync(join(tmpdir(), "kaitu-gh-pipe-"));
Object.assign(process.env, {
  GH_CONFIG_DIR: temp,
  GH_TOKEN: "synthetic-only",
  GITHUB_TOKEN: "synthetic-only",
  GH_ENTERPRISE_TOKEN: "synthetic-only",
  GH_PROMPT_DISABLED: "1",
  NO_PROXY: "",
  no_proxy: "",
});
const cases = [];
try {
  for (const cancel of [true, false]) {
    const sockets = new Set();
    let connected = false;
    const controller = new AbortController();
    const server = createServer();
    server.on("connect", (_request, socket) => {
      connected = true;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      if (cancel) {
        socket.pause();
        controller.abort(new DOMException("Synthetic cancellation", "AbortError"));
      } else socket.destroy();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.HTTPS_PROXY = `http://127.0.0.1:${server.address().port}`;
    process.env.https_proxy = process.env.HTTPS_PROXY;
    const fallback = setTimeout(() => controller.abort(), 10000);
    try {
      let failure;
      try {
        await githubCliRequest(
          "synthetic/upload",
          "/git/trees",
          "POST",
          { value: "x".repeat(16 * 1024 * 1024) },
          controller.signal,
        );
      } catch (error) {
        failure = error;
      }
      assert.equal(connected, true);
      if (cancel)
        assert.ok(pendingAtAbort > 0, "stdin must still have a buffered upload body at cancellation");
      assert.ok(failure);
      assert.equal(cancel ? failure.name : failure.code, cancel ? "AbortError" : "GH_REQUEST");
      await setImmediate();
      await setImmediate();
      cases.push({ cancel, connected, pendingAtAbort, failure: cancel ? failure.name : failure.code });
    } finally {
      clearTimeout(fallback);
      controller.abort();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        gh: execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0],
        bufferedBodyBytes: 16 * 1024 * 1024,
        cases,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
