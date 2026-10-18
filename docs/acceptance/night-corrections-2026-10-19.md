# PR31 收尾修正（2026-10-19）

范围：从 `6b4ce4c` 接续当前隔离 worktree，唯一 writer，只用合成资料。
不改 schemas / PRD §6，不合并、rebase、force push、部署或安装 App。

## A：生产分发与子进程错误

- `scripts/package-web.mjs` 显式构建 `dist/cli/phone-worker.js`，与 bundle 中 runtime URL 相邻。
- 数字子进程退出码不会进入字符串 startsWith，保留原始错误堆栈。
- 行为回归强制实际 worker 子进程失败：命令退出 2，输出 Synthetic worker failure，无二次 TypeError。
- core build → npm typecheck → Biome → CLI build → Vitest 均通过，相关 1 文件 / 4 测试。
  Biome 首轮仅格式换行失败，修正后重跑全链通过。
- 实际运行 `node scripts/package-web.mjs` 到全新 `/tmp/NIGHT-CORR-A-package-1792348080`。
  依赖只链接本仓库已安装的 CLI node_modules，没有安装、publish 或生成发行安装包。
- 产物 CLI 实测 note + complete_next 两条 applied，五份 schema 通过，agent/computer generator 正确。
  有效外部 body_mass=72 + 重定向 state 预览隔离，正式 inbox 结果一致，重复 snapshots=0 且内容/mtime 零改。
  预览前后完整合成 workspace/state/external 内容及文件/目录 mtime 清单一致。
- 实际 bundle 时间（ms）：{"init": 858.7, "small-dryrun": 2578.4, "small-formal": 2187.7, "repeat-formal": 424.3, "repeat-dryrun": 591.6, "computer-generator": 420.5, "inert-48MiB-dryrun": 555.8, "external-redirected-dryrun": 2552.0, "external-formal": 2322.0, "external-repeat": 398.7}
  bundle 提前加载通用依赖，数字不可替代薄 CLI 性能结果。

日志：`/tmp/NIGHT-CORR-A-{core,typecheck,biome,cli-build,vitest,package,smoke}.log`。
详细合成证据 `/tmp/NIGHT-CORR-A-smoke/observed.json`。
