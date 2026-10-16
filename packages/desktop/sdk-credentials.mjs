import { join } from "node:path";
import { pathToFileURL } from "node:url";

const load = (name) => import(pathToFileURL(join(process.env.KAITU_DSH_MODULES, name, "lib/index.js")).href);
try {
  const [{ Context }, { LocalCredentialProvider }] = await Promise.all([
    load("@deepseek-ai/cordis"),
    load("@deepseek-ai/dsh-credentials-local"),
  ]);
  const ctx = new Context();
  const provider = new LocalCredentialProvider(ctx, { dshHome: process.env.DSH_HOME, watch: false });
  if (process.argv[2] === "save") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    await provider.set("DEEPSEEK_API_KEY", JSON.parse(input).apiKey);
    input = "";
    process.stdout.write('{"configured":true}');
  } else {
    // Initialize through Cordis so the provider reads its managed store.
    const { Service } = await load("@deepseek-ai/cordis");
    const init = provider[Service.init]();
    await init.next();
    await init.next();
    const info = await provider.describe("DEEPSEEK_API_KEY");
    process.stdout.write(JSON.stringify({ configured: info.configured }));
    await init.return();
  }
  await ctx.fiber.dispose();
} catch {
  process.stderr.write("无法读取或保存 AI 凭据");
  process.exitCode = 1;
}
