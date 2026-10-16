import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateConnection } from "./sdk-providers.mjs";
import { searchProviders } from "./sdk-search-settings.mjs";

const load = (name) => import(pathToFileURL(join(process.env.KAITU_DSH_MODULES, name, "lib/index.js")).href);
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
  const ref = input.ref ?? "DEEPSEEK_API_KEY";
  if (!/^(?:DEEPSEEK_API_KEY|KAITU_[A-Z_]+_API_KEY)$/.test(ref)) throw new Error();
  if (process.argv[2] === "save") {
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
    } else if (process.argv[2] === "validate") {
      const apiKey = input.apiKey ?? (await provider.resolve(ref))?.value;
      const result = apiKey
        ? await validateConnection(input.settings, apiKey)
        : { code: "AI_KEY", message: "请先填入这个 AI 服务的 API Key" };
      process.stdout.write(JSON.stringify(result));
    } else {
      const info = await provider.describe(ref);
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
      process.stdout.write(JSON.stringify({ configured: info.configured, ...(search ? { search } : {}) }));
    }
    await init.return();
  }
  await ctx.fiber.dispose();
} catch {
  process.stderr.write("无法读取或保存 AI 凭据");
  process.exitCode = 1;
}
