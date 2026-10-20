# 最小饮食快照契约与 consumer 验收

基线 main：e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6。草稿 PR #64，独立分支 codex/phone-nutrition-snapshot。核心 producer 首次固定于 1f6358ad7229e67180334d2cb66a02ae0ff12ce9；后续只保留混合文件中既有 experience 幂等导入路径，并补本报告/脚本。未合并、发布或部署。

精确契约见 [phone-contract](../../guides/phone-contract.md) 饮食与水位两节；官方 schema/fixture 是 schemas/phone-today.schema.json 与 schemas/fixtures/phone/today.json。正式 producer 总是完整 v1；shared schema 容纳缺失/不完整/未知版本的可选 nutrition，让手机接受整个较新 Today 并降级营养区。没有新增公开格式或修改 meal/records/receipts schema。

## 实际执行

- Linux build、typecheck、lint 通过；全量 279 passed / 2 既有 skipped。日志见 evidence/nutrition-*.log。最后保留 experience 原有调用的微调后，core build 与 2 条定向恢复/日期测试再次通过；未机械重跑无关全量。
- 新增仅两条用户行为测试：日期/时区/最新修订/删除/水位/缺能力，以及三处真实文件写入边界的显式合成故障（追加前、追加后、消费账本终态前）。重开后同 ID、无重复修订；未恢复的 prepared 不发布 nutrition。合成错误注入，不冒充 OS 或真实同步盘故障。
- 独立集成副本 /tmp/kaitu-nutrition-integration 从本 PR producer detached 建立，仅在该副本合入 PR62 固定 a092270ff37f20200ddf5a7e8446684d54b46fc3。冲突仅是把 PR62 的 superseded 来源保留逻辑放进本 PR 抽出的 writeRecordReceipt；本 PR 分支未带入它的代码。相关测试 11/11 通过。
- 用该副本真实完整构建后的 CLI 执行 scripts/verify-phone-nutrition.mjs；从官方 records fixture 构造合成输入（不是 Swift writer，跨语言尚待接续），没有替换 Git、伪造系统时间或修改文件时间戳。今天取 CLI 实际生成日期；移除展示 receipts 仅检验私有账本独立性，不冒称真实等候十四天。

CLI 顺序：init → 确认餐入箱 → phone run → 删除展示回执并同名重投 → 替换 → 撤回 → 延迟重投旧来源 → 显式在原子 rename 消费终态前抛错 → 正常重开恢复。

结果分别为 720/38 → 720/38 → 500/30 → 0/0 → 0/0 → 中断的 prepared → 720/38。accounted_refs 依次保留所有消费来源，包括已 superseded 与撤回来源；事务恢复保留 preparedId，最终 canonical meal 只有一餐。原始 Today/receipt/两份私有 ledger 每阶段保存在 evidence/01–07 目录。06 阶段 CLI 已失败，留存的是上一次完整快照，不能将它称作本次已发布；单独测试验证主动投影会省略未恢复能力。

## 复现

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/verify-phone-nutrition.mjs <独立集成代码目录> <证据输出目录>
```

本 PR 明确依赖 PR62 的同名去重与 superseded 替换校验；请勿单支当作已完成依赖集成。单权威 consumer 与完整私有账本是边界，跨整理器丢 ledger 未解决。未做真机、iCloud、真实 GitHub 同步或原生 GUI，合成 CLI 不能代替这些。

## iOS 接续（待原 writer 固定输入）

通过 PR64 与 kaitu-ios PR10 评论已交精确契约、producer SHA、官方 fixture 与真实 CLI 命令。等待 PhoneMealDraft/PhoneRepository 实际确认生成的固定 records 原字节（仓库/SHA/路径），将保持 basename 和内容不变，经同一 official consumer 输出 Today、receipt 与账本，再交回 Swift 解码/汇总。不把双方各自手写的样例计为跨语言通过。

## CI

最终 exact-head CI 以 PR64 评论/正文回执为准。已知基线 Windows 两项失败（ask-filesystem 的 FS_SANDBOX_DENIED、feishu 缺 lark-cli）须与新失败分列；不修改 CI、增加 skip 或放宽 timeout。

## 最后定向收口

- Phone 持久化异常即使发生在 prepared ledger 首次 rename 前，也保留原文件可重试；不降格为永久 rejected 笔记。在加入相同尾部修复的独立集成副本，用真实 CLI + 显式 rename 故障验证：新文件保留、账本无该 ref、旧总量仍 720；取消注入后原文件一次消费，累计 1440，证据在 evidence/before-prepared。不是 Swift 输入，也不是 OS 自发故障。
- 投影汇总显式用同一 envelope 的 data.today/data.timeZone 归日，不依赖工作区再次读取的时区；避免后台读取期间 rules 变化后混入另一时区的合计。原有日期测试增加同一餐在洛杉矶/上海两个 envelope 下的归日校验，仍只有两条测试。最新定向日志为 nutrition-envelope-focused.log。

b21fee8 的 exact-head CI run 39345431578 已终态 failure：Mac/Windows 都在 lint 检出 evidence/before-prepared/result.json 末尾少换行；build/typecheck/test 未执行。此为本 PR 的证据格式疏漏，不归于已知 Windows 测试失败。仅补换行后全仓 lint 通过；新 head 的终态另在 PR64 回执。
