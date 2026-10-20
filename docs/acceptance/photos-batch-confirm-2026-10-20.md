# 照片经历批量确认与撤销

基线：远端 main `e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`。独立分支 `codex/photos-batch-confirm`，工作树 `/tmp/kaitu-photos-worktree`。只使用临时合成工作区和隔离应用状态。

## 行为与范围

- 本机可信的 `experienceBatchPreview` / `changeExperienceBatch` 增加 `confirm`，手机 action、记录 schema 不变。
- 核对批次预期 revision，成员当前 revision 必须等于批次保存的 revision；只确认仍有效、城市已解析的 inferred。人工编辑、隐藏、未知/歧义城市、其他事实状态保持原样。
- 确认的 `observed` 修订与 `batch.items[].revision` 一起写进现有 record transaction。撤销恢复继续按严格的修订匹配工作，确认后人工编辑或隐藏也不会被回滚。过时的批次 revision 即使操作已完成也返回冲突。
- `ExperienceImportControls` 显示待核对批次和「这批全部确认」，来源 `apple-photos` 显示「照片」；沿用原有影响预览、撤销、恢复、排除来源。MapPage 只有一行待核对数量接线，没有地图样式改动。
- PHOTOS producer 示例只交 `place.name/country`；保留入口拒绝坐标、geonameid、precision 的约束。

## 验证证据

新增三个行为测试，均在 `packages/core/test/experience-imports.test.ts`，没有假 git 或假计时：

1. `ios-synthetic-*.records.jsonl` 收件：京都住过、巴黎旅行、伦敦旅行，一批三城市；收件先为 agent / inferred，0 个地图点、3 条待核对；批量确认后 3 个点，成员指针升至 rev 2；整批撤销后 0 条可见经历；恢复 rev 4 且保持 observed。确认前后、撤销后的重扫均不重复；关闭照片来源后新日期不新增；过时 revision 拒绝；精确坐标输入仍为 BAD_ARGS。
2. 确认前独立编辑/隐藏、无法解析城市、已报告经历跳过；确认后再次编辑/隐藏也不被整批撤销和恢复覆盖。
3. 确认的经历修订已落盘、批次指针落盘前模拟存储中断：重开仍显示 0 个点、3 条待核对；恢复日志补完后才显示整批，修订不重复，随后可整批撤销。

本机 HTTP（实际启动隔离的 `startUi`，没有连接 AI 或外部账号）走完同一闭环：`/api/product/experienceBatchPreview`、`changeExperienceBatch`、`lifeMap`、`setExperienceSource`；过时 revision 实际返回 HTTP 409。三城市工作区确认 26.17ms、撤销 13.63ms、恢复 22.81ms；初次 lifeMap 45.05ms。

Node 26.11.1 / pnpm 11.22.0，合成 3,003 条经历的大工作区实测（真实文件与版本写入）：

| 操作 | 毫秒 |
|---|---:|
| 读取地图 | 30.22 |
| 读取来源与批次 | 16.85 |
| 预览三条照片确认范围 | 12.30 |
| 确认三条照片 | 208.35 |
| 撤销三条照片 | 188.15 |
| 恢复三条照片 | 156.46 |
| 导入三条照片 | 397.18 |
| 一次性导入 3,000 条背景经历 | 7,417.24 |

本次日常批次操作低于 300ms；UI 点击时先设置 busy。3,000 条一次性导入超过 1 秒，时间包含既有整批准备、校验、去重与文件/版本保存；没有把此基线导入性能问题纳入本次照片确认修复。

完整检查：`pnpm lint`、`pnpm build`、`pnpm typecheck` 通过；`pnpm test` 94 个文件、282 项通过（136.05 秒）。最终补充坐标拒绝断言后，定向 5 项再次通过（9.28 秒）。exact SHA CI 记录在草稿 PR。沙箱初跑因 localhost listen EPERM 失败，停止该轮后在允许本机监听的环境重跑；测试自带临时 HOME / 状态隔离。

## 未测项

- 环境浏览器清单为空（iab unavailable），无法完成真实浏览器/原生窗口点击与截图。已完成可信 HTTP 路径和前后端构建/类型检查；UI 视觉、焦点和实际点击仍待有浏览器时走查。
- 未访问真实相册、iPhone、iCloud、Drive 或用户个人工作区；照片读取和手机队列真机验证由 iOS 线程完成。
- 不合并、不发布；远端 CI 的 SHA、运行链接与结果见草稿 PR。
