import { createRequire, findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchModels, validateConnection, providers, extendProviders } from "./sdk-providers.mjs";
import { searchProviders } from "./sdk-search-settings.mjs";

const resolveModule = createRequire(join(process.env.KAITU_DSH_MODULES, "package.json")).resolve;
const load = (name) => import(pathToFileURL(resolveModule(name)).href);
async function piCatalog() {
  const parent = pathToFileURL(resolveModule("@deepseek-ai/dsh-llm-pi-ai/package.json")).href;
  const root = dirname(findPackageJSON("@earendil-works/pi-ai", parent));
  return import(pathToFileURL(join(root, "dist/providers/all.js")).href);
}
async function providerDirectory() {
  const pi = await piCatalog();
  extendProviders(
    pi.builtinProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseURL: provider.baseUrl ?? pi.getBuiltinModels(provider.id)[0]?.baseUrl,
      api: pi.getBuiltinModels(provider.id)[0]?.api,
      catalog: true,
      authMethods: [
        ...(provider.auth.oauth
          ? [{ id: "oauth", label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name }]
          : []),
        ...(provider.auth.apiKey?.login ? [{ id: "api-key", label: provider.auth.apiKey.name }] : []),
      ],
      authKey: `llm-pi-ai/${provider.id}`,
    })),
  );
  return providers;
}
async function knownModels(settings) {
  if (!settings || settings.provider.startsWith("kaitu-")) return [];
  if (settings.provider === "deepseek-official") {
    const { resolveAdapterOptions } = await load("@deepseek-ai/dsh-llm-deepseek");
    return resolveAdapterOptions({}).models.map((m) => ({
      id: m.id,
      image: m.inputModalities?.includes("image") ?? false,
    }));
  }
  const { getBuiltinModels, getBuiltinProviders } = await piCatalog();
  return getBuiltinProviders().includes(settings.provider)
    ? getBuiltinModels(settings.provider).map((m) => ({ id: m.id, image: m.input.includes("image") }))
    : [];
}
try {
  const [{ Context }, { LocalCredentialProvider }] = await Promise.all([
    load("@deepseek-ai/cordis"),
    load("@deepseek-ai/dsh-credentials-local"),
  ]);
  const ctx = new Context();
  const provider = new LocalCredentialProvider(ctx, { dshHome: process.env.DSH_HOME, watch: false });
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  raw = "";
  await providerDirectory();
  const ref = input.ref ?? "DEEPSEEK_API_KEY";
  if (!/^(?:DEEPSEEK_API_KEY|KAITU_[A-Z0-9_]+_API_KEY)$/.test(ref)) throw new Error();
  if (process.argv[2] === "catalog") {
    process.stdout.write(JSON.stringify(providers));
  } else if (process.argv[2] === "save") {
    await provider.set(ref, input.apiKey);
    process.stdout.write('{"configured":true}');
  } else {
    // Initialize through Cordis so the provider reads its managed store.
    const { Service } = await load("@deepseek-ai/cordis");
    const init = provider[Service.init]();
    await init.next();
    await init.next();
    if (process.argv[2] === "unset") {
      await provider.unset(ref);
      process.stdout.write('{"configured":false}');
    } else if (process.argv[2] === "models") {
      const apiKey =
        input.apiKey ?? (input.useStoredKey === false ? undefined : (await provider.resolve(ref))?.value);
      const result = await fetchModels(input.settings, apiKey);
      if (result.models) {
        const known = await knownModels(input.settings);
        result.models = result.models.map((m) => ({ ...known.find((k) => k.id === m.id), ...m }));
      }
      process.stdout.write(JSON.stringify(result));
    } else if (process.argv[2] === "validate") {
      const apiKey = input.apiKey ?? (await provider.resolve(ref))?.value;
      const result = apiKey
        ? await validateConnection(input.settings, apiKey)
        : { code: "AI_KEY", message: "请先填入这个 AI 服务的 API Key" };
      process.stdout.write(JSON.stringify(result));
    } else {
      const info =
        input.settings?.auth === "dsh"
          ? {
              configured: (await provider.listRecords()).some(
                (record) => record.key === `llm-pi-ai/${input.settings.provider}`,
              ),
            }
          : await provider.describe(ref);
      const search =
        process.argv[2] === "search-status" || input.search
          ? Object.fromEntries(
              await Promise.all(
                searchProviders.map(async (entry) => [
                  entry.id,
                  (await provider.describe(entry.ref)).configured,
                ]),
              ),
            )
          : undefined;
      const model =
        input.settings && (await knownModels(input.settings)).find((m) => m.id === input.settings.model);
      process.stdout.write(
        JSON.stringify({
          configured: info.configured,
          ...(model ? { supportsImages: model.image } : {}),
          ...(search ? { search } : {}),
        }),
      );
    }
    await init.return();
  }
  await ctx.fiber.dispose();
} catch {
  process.stderr.write("无法读取或保存 AI 凭据");
  process.exitCode = 1;
}
