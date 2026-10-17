import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";
import { makeGmailProvider } from "../src/collectors/gmail.js";
import { CollectorService } from "../src/collectors/service.js";

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-gmail-"));
  const ws = await initWorkspace(join(root, "workspace"));
  const calls: string[] = [];
  let challenge = "";
  let authorized!: Promise<Response>;
  let cursor = "10";
  const api = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    let result: unknown;
    if (url.pathname === "/token") {
      if (body.get("grant_type") === "authorization_code") {
        expect(
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url"),
        ).toBe(challenge);
        expect(body.get("code")).toBe("fake-code");
      } else expect(body.get("refresh_token")).toBe("synthetic-refresh");
      result = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 1 };
    } else if (url.pathname === "/revoke") {
      expect(body.get("token")).toBe("synthetic-refresh");
      result = {};
    } else {
      expect(req.headers.authorization).toBe("Bearer synthetic-access");
      if (url.pathname === "/profile") result = { emailAddress: "test@example.test", historyId: cursor };
      else if (url.pathname === "/messages") result = { messages: [{ id: "one" }] };
      else if (url.pathname === "/history") {
        expect(["10", "11"]).toContain(url.searchParams.get("startHistoryId"));
        result = { history: [{ messagesAdded: [{ message: { id: "one" } }, { message: { id: "two" } }] }] };
      } else
        result = {
          id: url.pathname.split("/").pop(),
          internalDate: "1800000000000",
          snippet: "摘".repeat(400),
          payload: {
            headers: [
              { name: "From", value: "friend@example.test" },
              { name: "Subject", value: "合成邮件" },
            ],
          },
        };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  const provider = makeGmailProvider({
    clientId: "synthetic-client",
    authUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    revokeUrl: `${base}/revoke`,
    apiUrl: base,
    async openBrowser(value) {
      const url = new URL(value);
      expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
      challenge = url.searchParams.get("code_challenge") ?? "";
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
      const invalid = new URL(callback);
      invalid.search = new URLSearchParams({ state: "invalid", code: "bad" }).toString();
      expect((await fetch(invalid)).status).toBe(400);
      callback.search = new URLSearchParams({
        state: url.searchParams.get("state") ?? "",
        code: "fake-code",
      }).toString();
      authorized = fetch(callback);
    },
  });
  const service = new CollectorService(ws, join(root, "local"), { gmail: provider });
  await service.request("gmail-login");
  await authorized;
  let id = "";
  for (let count = 0; count < 100; count++) {
    const view = (await service.request("list")) as { accounts: { id: string; lastFetch?: string }[] };
    if (view.accounts[0]?.lastFetch) {
      id = view.accounts[0].id;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(id).not.toBe("");
  return {
    root,
    ws,
    service,
    id,
    calls,
    advance: () => {
      cursor = "11";
    },
    async close() {
      await service.stop();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
it("Gmail PKCE 登录后增量收取、重复不重写，令牌仅保存在本机 600 文件", async () => {
  const f = await fixture();
  try {
    const original = files(f.ws.resolve("inbox")).find((file) => file.endsWith(".note.md"));
    expect(original).toBeDefined();
    const mtime = statSync(original ?? "").mtimeMs;
    f.advance();
    await f.service.request("test", { id: f.id });
    await f.service.request("test", { id: f.id });
    const notes = files(f.ws.resolve("inbox")).filter((file) => file.endsWith(".note.md"));
    expect(notes).toHaveLength(2);
    expect(statSync(original ?? "").mtimeMs).toBe(mtime);
    expect(
      readFileSync(original ?? "", "utf8")
        .split("摘录：")[1]
        ?.trim(),
    ).toHaveLength(280);
    const view = JSON.stringify(await f.service.request("list"));
    const workspace = files(f.ws.root)
      .map((file) => readFileSync(file, "utf8"))
      .join("");
    for (const token of ["synthetic-access", "synthetic-refresh"]) {
      expect(workspace).not.toContain(token);
      expect(view).not.toContain(token);
    }
    const tokens = files(join(f.root, "local")).filter((file) =>
      readFileSync(file, "utf8").includes("synthetic-refresh"),
    );
    expect(tokens).toHaveLength(1);
    if (process.platform !== "win32") expect(statSync(tokens[0] ?? "").mode & 0o777).toBe(0o600);
    expect(f.calls.some((call) => call.startsWith("GET /history?"))).toBe(true);
  } finally {
    await f.close();
  }
});
it("Gmail 断开调用撤销并删除本机令牌和账号，保留已收笔记", async () => {
  const f = await fixture();
  try {
    expect(await f.service.request("disconnect", { id: f.id })).toEqual({ disconnected: true });
    expect(f.calls).toContain("POST /revoke");
    expect(((await f.service.request("list")) as { accounts: unknown[] }).accounts).toHaveLength(0);
    expect(
      files(join(f.root, "local"))
        .map((file) => readFileSync(file, "utf8"))
        .join(""),
    ).not.toContain("synthetic-refresh");
    expect(files(f.ws.resolve("inbox")).filter((file) => file.endsWith(".note.md"))).toHaveLength(1);
  } finally {
    await f.close();
  }
});
