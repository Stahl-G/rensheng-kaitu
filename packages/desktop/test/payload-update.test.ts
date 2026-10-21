import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initWorkspace } from "@kaitu/core";
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { rollback, selectPayload, selection, updateRoot } from "../payload-loader.mjs";
import { createPayloadUpdater, installPayload, verifyRelease } from "../payload-update.mjs";
import { readUpdateConfig } from "../update-config.mjs";

it("真实下载已签名功能包，切换后读取新功能，回退保留内核和原版本", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-feature-update-"));
  const state = join(root, "state");
  const resources = join(root, "Resources");
  const payload = join(resources, "kaitu");
  const ws = await initWorkspace(join(root, "workspace"));
  ws.writeText("me/keep.md", "合成资料，升级与回退都要保留。\n");
  mkdirSync(join(payload, "node_modules"), { recursive: true });
  const base = { version: "0.1.0", dshVersion: "0.2.1-rc.2", hostApi: 1 };
  writeFileSync(join(payload, "payload.json"), JSON.stringify(base));
  writeFileSync(join(resources, "app.asar"), "fixed engine");
  const metadata = { ...base, version: "0.1.1-rc.1" };
  const entries = Object.fromEntries(
    [
      ["payload.json", JSON.stringify(metadata)],
      ["dist/local.mjs", "export const version = 'new';"],
      ["dist/initialize.mjs", ""],
      ["dist/index.js", ""],
      ["dist/sdk-plugin.mjs", ""],
      ["web/index.html", "new UI"],
    ].map(([name, text]) => [name, Buffer.from(text)]),
  );
  const bytes = Buffer.from(zipSync(entries));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const served: { envelope?: { manifest: string; signature: string }; bytes: Buffer } = { bytes };
  let payloadDownloads = 0;
  const server = createServer((req, res) => {
    if (req.url === "/feed" || req.url === "/features.zip") {
      res.writeHead(302, { Location: req.url === "/feed" ? "/latest.json" : "/payload.zip" });
      res.end();
    } else if (req.url === "/latest.json") res.end(JSON.stringify(served.envelope));
    else {
      payloadDownloads++;
      res.end(served.bytes);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const release = {
    ...metadata,
    url: `${origin}/features.zip`,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const signed = (value) => {
    const manifest = JSON.stringify(value);
    return { manifest, signature: sign(null, Buffer.from(manifest), privateKey).toString("base64") };
  };
  const envelope = signed(release);
  served.envelope = envelope;
  const keyFile = join(root, "synthetic-public.pem");
  writeFileSync(keyFile, publicKey.export({ type: "spki", format: "pem" }));
  expect(() => readUpdateConfig({ version: "0.1.1" })).toThrow();
  const official = readUpdateConfig({ version: "0.1.1", publicKeyFile: keyFile });
  expect(official.feedUrl).toBe(
    "https://github.com/Stahl-G/rensheng-kaitu/releases/download/desktop-stable-dsh-0.2.1-rc.2-host-1/latest.json",
  );
  writeFileSync(
    join(resources, "kaitu-update.json"),
    JSON.stringify({
      feedUrl: `${origin}/feed`,
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    }),
  );
  const updater = createPayloadUpdater({ state, resources, payload, restart: () => {} });
  try {
    expect(selectPayload(state, resources)).toBe(payload);
    await updater.request("automatic:off");
    const reopened = createPayloadUpdater({ state, resources, payload, restart: () => {} });
    await reopened.checkAutomatically();
    expect((await reopened.request()).phase).toBe("idle");
    await reopened.request("automatic:on");
    await reopened.checkAutomatically();
    expect((await reopened.request()).phase).toBe("available");
    expect(payloadDownloads).toBe(0);
    expect(selectPayload(state, resources)).toBe(payload);
    await updater.request("check");
    await expect.poll(async () => (await updater.request()).phase).toBe("available");
    await updater.request("install");
    await expect.poll(async () => (await updater.request()).phase).toBe("ready");
    const active = selectPayload(state, resources);
    expect((await import(pathToFileURL(join(active, "dist/local.mjs")).href)).version).toBe("new");
    expect(readFileSync(join(active, "web/index.html"), "utf8")).toBe("new UI");
    expect(realpathSync(join(active, "node_modules"))).toBe(realpathSync(join(payload, "node_modules")));
    expect(readFileSync(join(resources, "app.asar"), "utf8")).toBe("fixed engine");
    expect(ws.readText("me/keep.md")).toBe("合成资料，升级与回退都要保留。\n");
    const updated = createPayloadUpdater({ state, resources, payload: active, restart: () => {} });
    served.envelope = { ...envelope, manifest: envelope.manifest.replace("0.1.1", "9.0.0") };
    await updated.checkAutomatically();
    expect((await updated.request()).phase).toBe("error");
    expect(selectPayload(state, resources)).toBe(active);
    expect(payloadDownloads).toBe(1);
    served.envelope = signed({ ...release, version: "0.1.2" });
    await updated.checkAutomatically();
    served.bytes = Buffer.from("interrupted download");
    await updated.request("install");
    await expect.poll(async () => (await updated.request()).phase).toBe("error");
    expect(selectPayload(state, resources)).toBe(active);
    // The same channel can advance again; it is not pinned to the first released version.
    served.bytes = Buffer.from(
      zipSync({
        ...entries,
        "payload.json": Buffer.from(JSON.stringify({ ...metadata, version: "0.1.2" })),
      }),
    );
    served.envelope = signed({
      ...release,
      version: "0.1.2",
      size: served.bytes.length,
      sha256: createHash("sha256").update(served.bytes).digest("hex"),
    });
    await updated.checkAutomatically();
    await updated.request("install");
    await expect.poll(async () => (await updated.request()).phase).toBe("ready");
    expect(
      JSON.parse(readFileSync(join(selectPayload(state, resources), "payload.json"), "utf8")).version,
    ).toBe("0.1.2");
    rollback(state);
    expect(selectPayload(state, resources)).toBe(active);
    rollback(state);
    expect(selectPayload(state, resources)).toBe(payload);
    expect(existsSync(active)).toBe(true);
    expect(ws.readText("me/keep.md")).toBe("合成资料，升级与回退都要保留。\n");
    expect(() =>
      verifyRelease({ ...envelope, manifest: envelope.manifest.replace("0.1.1", "9.0.0") }, publicKey),
    ).toThrow();
    expect(() => verifyRelease(signed({ ...release, dshVersion: "9.0.0" }), publicKey)).toThrow();
    await expect(
      installPayload({ state, resources, release, bytes: Buffer.from("broken") }),
    ).rejects.toThrow();
    expect(selection(state).current).toBe(null);
    const hostile = Buffer.from(zipSync({ ...entries, "../outside": Buffer.from("bad") }));
    await expect(
      installPayload({
        state,
        resources,
        release: {
          ...release,
          size: hostile.length,
          sha256: createHash("sha256").update(hostile).digest("hex"),
        },
        bytes: hostile,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(updateRoot(state), "outside"))).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
