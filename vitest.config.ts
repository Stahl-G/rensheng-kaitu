import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "kaitu-test-typescript",
      enforce: "pre",
      transform(code: string, id: string) {
        if (!id.includes("/packages/dsh-plugin/src/") || !id.endsWith(".ts")) return;
        const result = ts.transpileModule(code, {
          fileName: id,
          compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, sourceMap: true },
        });
        return {
          code: result.outputText,
          map: result.sourceMapText ? JSON.parse(result.sourceMapText) : undefined,
        };
      },
    },
  ],
  resolve: {
    alias: {
      "@kaitu/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 2,
    // 测试多在临时目录里跑真实 git 与文件读写，机器忙时单个测试会超过默认 5 秒。
    testTimeout: 15000,
    include: ["packages/*/test/**/*.test.ts"],
    setupFiles: ["./test/isolate-home.ts"],
  },
});
