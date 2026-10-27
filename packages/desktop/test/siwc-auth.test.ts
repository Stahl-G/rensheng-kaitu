import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
// @ts-expect-error Desktop build adapters are native ESM.
import { adaptSiwcSource } from "../siwc-compat.mjs";

type Attempt = {
  authorizationUrl: string;
  completion: Promise<{ issuedClientId: string; subject: string }>;
  cancel(): void;
};
type Auth = {
  beginSignIn(options: { hostId: string; reusePendingRegistration?: boolean }): Promise<Attempt>;
};
const root = mkdtempSync(join(tmpdir(), "kaitu-siwc-auth-"));
const requirePlugin = createRequire(new URL("../../dsh-plugin/package.json", import.meta.url));
const plugin = requirePlugin.resolve("dsh-plugin-chatgpt-siwc");
const requireSiwc = createRequire(plugin);
const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(requireSiwc.resolve("jose")).href);
let SiwcAuth: new (transport: typeof fetch) => Auth;
beforeAll(async () => {
  const { build } = requirePlugin("esbuild");
  const output = join(root, "auth.mjs");
  await build({
    entryPoints: [join(dirname(plugin), "auth/index.js")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    plugins: [
      {
        name: "production-siwc-adaptations",
        setup(builder: {
          onLoad(filter: { filter: RegExp }, load: (args: { path: string }) => unknown): void;
        }) {
          builder.onLoad({ filter: /auth[\\/](?:index|loopback)\.js$/ }, ({ path }) => ({
            contents: adaptSiwcSource(path, readFileSync(path, "utf8")),
            loader: "js",
          }));
        },
      },
    ],
  });
  ({ SiwcAuth } = await import(pathToFileURL(output).href));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const issuer = "https://auth.openai.com";
  const client = "oaiapp_synthetic";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = { ...(await exportJWK(publicKey)), kid: "fixture", alg: "RS256", use: "sig" };
  const exchanges: URLSearchParams[] = [];
  let nonce = "";
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(issuer);
    if (url.pathname === "/.well-known/openid-configuration")
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/api/accounts/authorize`,
        token_endpoint: `${issuer}/api/accounts/oauth/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (url.pathname === "/jwks") return Response.json({ keys: [key] });
    expect(url.pathname).toBe("/api/accounts/oauth/token");
    exchanges.push(new URLSearchParams(String(init?.body)));
    if (exchanges.length === 1)
      return Response.json(
        { error: "invalid_grant", error_description: "synthetic private provider detail" },
        { status: 400 },
      );
    const jwt = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer)
      .setAudience(client)
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    return Response.json({
      access_token: "synthetic-access",
      id_token: jwt,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "chatgpt.tokens.use.direct",
    });
  };
  const auth = new SiwcAuth(transport);
  return {
    auth,
    client,
    exchanges,
    async begin(reusePendingRegistration?: boolean) {
      const attempt = await auth.beginSignIn({ hostId: "synthetic-host", reusePendingRegistration });
      const authorization = new URL(attempt.authorizationUrl);
      nonce = authorization.searchParams.get("nonce") as string;
      return { attempt, authorization };
    },
  };
}
function callback(authorization: URL, code: string, client?: string) {
  const url = new URL(authorization.searchParams.get("redirect_uri") as string);
  url.search = new URLSearchParams({
    state: authorization.searchParams.get("state") as string,
    code,
    ...(client ? { client_id: client } : {}),
  }).toString();
  return url;
}

test("rejected authorization code is discarded; a user retry retains the issued client with fresh PKCE, state and nonce", async () => {
  const f = await fixture();
  const first = await f.begin();
  expect(first.authorization.searchParams.get("agent_name_hint")).toBe("Kaitu ChatGPT SIWC");
  const failure = await fetch(callback(first.authorization, "first-synthetic-code", f.client));
  const page = await failure.text();
  expect(page).toContain("Return to Kaitu");
  expect(page).not.toContain("synthetic private provider detail");
  await expect(first.attempt.completion).rejects.toMatchObject({ code: "invalid_grant" });
  const retry = await f.begin();
  try {
    expect(retry.authorization.searchParams.get("client_id")).toBe(f.client);
    expect(retry.authorization.searchParams.has("agent_name_hint")).toBe(false);
    for (const field of ["state", "nonce", "code_challenge"])
      expect(retry.authorization.searchParams.get(field)).not.toBe(
        first.authorization.searchParams.get(field),
      );
    // Returning dynamic registrations may omit client_id in their callback.
    const success = await fetch(callback(retry.authorization, "new-synthetic-code"));
    expect(await success.text()).toContain("return to Kaitu");
    await expect(retry.attempt.completion).resolves.toMatchObject({
      issuedClientId: f.client,
      subject: "synthetic-subject",
    });
    expect(f.exchanges.map((form) => form.get("code"))).toEqual([
      "first-synthetic-code",
      "new-synthetic-code",
    ]);
    const form = f.exchanges[1] as URLSearchParams;
    expect(form.get("redirect_uri")).toBe(retry.authorization.searchParams.get("redirect_uri"));
    expect(
      createHash("sha256")
        .update(form.get("code_verifier") as string)
        .digest("base64url"),
    ).toBe(retry.authorization.searchParams.get("code_challenge"));
  } finally {
    retry.attempt.cancel();
  }
});

test("a retained retry rejects a changed client; explicit new-account registration starts fresh", async () => {
  const f = await fixture();
  const first = await f.begin();
  await fetch(callback(first.authorization, "rejected", f.client));
  await expect(first.attempt.completion).rejects.toMatchObject({ code: "invalid_grant" });
  const retry = await f.begin();
  await fetch(callback(retry.authorization, "unused", "oaiapp_unrelated"));
  await expect(retry.attempt.completion).rejects.toMatchObject({ code: "invalid_identity" });
  expect(f.exchanges).toHaveLength(1);
  const fresh = await f.begin(false);
  expect(fresh.authorization.searchParams.get("client_id")).toBe("dynamic_agent_client");
  fresh.attempt.cancel();
  await expect(fresh.attempt.completion).rejects.toMatchObject({ code: "cancelled" });
});
