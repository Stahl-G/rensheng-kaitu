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
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { rollback, selectPayload, selection, updateRoot } from "../payload-loader.mjs";
import { createPayloadUpdater, installPayload, verifyRelease } from "../payload-update.mjs";

it("真实下载已签名功能包，切换后读取新功能，回退保留内核和原版本", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-feature-update-"));
  const state = join(root, "state");
  const resources = join(root, "Resources");
  const payload = join(resources, "kaitu");
  mkdirSync(join(payload, "node_modules"), { recursive: true });
  const base = { version: "0.1.0", dshVersion: "0.2.0-rc.2", hostApi: 1 };
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
  const served: { envelope?: { manifest: string; signature: string } } = {};
  const server = createServer((req, res) =>
    res.end(req.url === "/latest.json" ? JSON.stringify(served.envelope) : bytes),
  );
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
  writeFileSync(
    join(resources, "kaitu-update.json"),
    JSON.stringify({
      feedUrl: `${origin}/latest.json`,
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    }),
  );
  const updater = createPayloadUpdater({ state, resources, payload, restart: () => {} });
  try {
    expect(selectPayload(state, resources)).toBe(payload);
    expect((await updater.request("check")).phase).toBe("checking");
    await expect.poll(async () => (await updater.request()).phase).toBe("available");
    await updater.request("install");
    await expect.poll(async () => (await updater.request()).phase).toBe("ready");
    const active = selectPayload(state, resources);
    expect(readFileSync(join(active, "web/index.html"), "utf8")).toBe("new UI");
    expect(realpathSync(join(active, "node_modules"))).toBe(realpathSync(join(payload, "node_modules")));
    expect(readFileSync(join(resources, "app.asar"), "utf8")).toBe("fixed engine");
    rollback(state);
    expect(selectPayload(state, resources)).toBe(payload);
    expect(existsSync(active)).toBe(true);
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
