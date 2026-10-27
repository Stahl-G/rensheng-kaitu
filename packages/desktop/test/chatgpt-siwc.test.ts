import { expect, test } from "vitest";
// @ts-expect-error Desktop entry points are native ESM.
const { sdkRuntimePatch } = await import("../sdk-runtime.mjs");
// @ts-expect-error Desktop entry points are native ESM.
const { selection, providerPatch, providers } = await import("../sdk-providers.mjs");

test("ChatGPT plan uses its own adapter in both desktop SDK modes", () => {
  const entry = providers.find((provider: { id: string }) => provider.id === "chatgpt-siwc");
  expect(entry.authMethods).toEqual([{ id: "oauth", label: "Continue with ChatGPT" }]);
  const selected = selection({ provider: entry.id, model: "synthetic", auth: "dsh" });
  expect(providerPatch(selected)).toEqual([]);
  for (const mode of ["scoped", "full"]) {
    const patch = sdkRuntimePatch({
      workspace: "/workspace",
      plugin: "/payload/plugin.mjs",
      hostPlugin: "/payload/sdk-host.mjs",
      mode,
    });
    expect(
      patch.flatMap((row: { insert?: { id: string; name: string }[] }) => row.insert ?? []),
    ).toContainEqual({ id: "chatgpt-siwc", name: "/payload/chatgpt-siwc.mjs" });
  }
});
