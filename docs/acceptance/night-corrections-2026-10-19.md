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

## B：ctime 与真实内容冲突

- 修前绑定 `6b4ce4c` 的普通 dist、以及保留 main → phone-command 的薄源码入口复测：
  复制、历史元数据与 worker 链路均未重现旧 `076b9a8` 的自发源文件 ctime 改变。
  原源文件 stat 轨迹没有 stampChanges，内容及 mtime 清单保持不变。
  因而旧报告当时的文件系统触发原因仍未证实，不能把猜测记为已定位。
- 可确定复现的原因是原 guard 把 ctime 等元数据变化直接视为资料变化。
  在副本已复制、生产 worker 执行前只 chmod 原 OVERVIEW，inode/size/mtime/内容完全不变：
  当前基线薄入口退出 2，报预览冲突；修后相同扰动退出 0，返回正常预览。
- 只对纳入复制的输入记录短生命周期内容摘要；stamp 变化时再核对内容。
  删除或真正改写仍报冲突，包括同长度写入且恢复原 mtime。检查也覆盖没有输出差异的原输入。
  不保留整树 Buffer，不复制历史对象，不访问已排除的媒体/cache，不改稳定等待和 timeout。
- 两个并发行为案例分别验证 metadata-only 可预览、真实改写拒绝；
  兼容性行为案例补齐重定向 state，与有效外部 body_mass=72、XML/ZIP、files/cache/chats 项目、
  同名 cache 模块和二进制附件一起验证。预览与正式五份快照除时间字段外一致，
  原 workspace/state/external 内容及文件/目录 mtime 无改，重复正式 snapshots=0 且零写。
- 同 probe 159 文件 / 214,106 → 214,103 字节（临时路径/状态字段差异）：

| 普通分文件 CLI | 修前 ms | 修后 ms | 修后父进程 readFileSync bytes |
| --- | ---: | ---: | ---: |
| 首次 note/action 预览 | 2685.9 | 2609.6 | 3503226 |
| 重复预览 | 998.1 | 729.3 | 3500906 |
| 加 32 MiB health/files + 16 MiB .kaitu/cache | 967.5 | 697.8 | 3501180 |
| 外部输入及重定向 state 预览 | 3931.0 | 2761.6 | 3506362 |

摘要增加约 153 KB 的小输入读取，48 MiB 惰性文件各阶段监测访问数为 0，没有约 96 MiB 双读。
这些是单次 wall，不能证明稳定提速；首次仍超过 1 秒，默认 processInbox 1.5 秒等待保留。
薄源码入口修前/后首次 3170.9/3554.1 ms，重复 1000.5/774.5 ms，惰性 846.3/707.3 ms，
外部状态 3008.8/2669.5 ms，同样没有源 stampChanges，不取更快样本替代普通 CLI。
临时薄入口首次缺 assets 的探针设置错误已补仓库 schemas/templates 链接后重跑，非产品失败。

检查：core build → npm typecheck → Biome → CLI tsc → 相关 Vitest 1 文件 / 6 测试通过。
日志 `/tmp/NIGHT-CORR-B-{core,typecheck,biome,cli-build,vitest,metadata,before,after,thin-before,thin-after}.log`。
详细规模/访问证据 `/tmp/NIGHT-CORR-B-{before,after}/observed.json`，
薄入口证据 `/tmp/NIGHT-CORR-B-thin-{before,after}-probe/observed.json`。

## C：项目与目标长标题输出

- 仅 `phone-projections.ts` 两处 title 沿用当前 clip(..., 80)，不改 schema 或源资料。
- 两个独立行为案例：生产 createProject、upsertGoal 分别接受 81 字符标题，
  实际 writePhoneSnapshots(force=true) 写出的 library 通过现有 schema。
  项目相对 STATUS 路径、目标 goals 路径及 id 仍可定位，原文件完整标题保留。
- core build → npm typecheck → Biome → 相关 Vitest 2 文件 / 16 测试通过。
  初步格式检查的模板字符串/缩进问题已修正，最终完整检查链全绿后提交。
- 日志 `/tmp/NIGHT-CORR-C-{core,typecheck,biome,vitest}.log`。

最终全套结果及现存 GUI、性能、iOS 限制同步到 PR31 说明与 `../NIGHT_CORRECTIONS_FINAL.md`、`../NIGHT_STATUS.md`。
