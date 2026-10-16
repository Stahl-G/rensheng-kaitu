import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kaitu/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 4,
    // 测试多在临时目录里跑真实 git 与文件读写，机器忙时单个测试会超过默认 5 秒。
    testTimeout: 15000,
    include: ["packages/*/test/**/*.test.ts"],
    setupFiles: ["./test/isolate-home.ts"],
  },
});
