# 首发引导调整交审

后续 `92edcf3` 的两类用户与可能路径调整已完成，见 [本轮交审](onboarding-paths.md)。以下保留上一轮执行记录。

依据 `origin/main 4cb2c3a` 的 launch PRD L4、L6、§9 与同版原型。本分支先合入 main，原型没有本地覆盖。
产品定义、引导 PRD、助手技能和 AGENTS.md 生成说明同步为新的流程。

## 实现

欢迎说明三分钟；默认「带来一件正在推进的事」，与「从常用的 AI 搬来记忆」并列。
原文先走 captureNote 写入收件箱；原文保存和用户采纳分开，其他建议不自动生成待办。

- 问问已配置时，用现有 Ask 会话返回三项草稿，经服务端校验后写入 me/STATUS.md 的 proposed 下一步。
- DSH 复用原生会话预填整理提示；发送后由现有工具保存待核对草稿，回到页面可以核对、修改、采纳。
- 无模型时三项由用户填写，界面说明。草稿失败保留同一段原文，可重试或手工完成。
- 采纳只添加一条 task，source 指向原文，notes 保存目标与现状；同一来源重复提交复用已有待办。
- 「只保存原文」保留原文并撤下未采纳草稿，不生成待办。归档原文后，来源仍可读回。
- 今天页在六项清单上方显示刚采纳的下一步、目标和原文，可完成并记结果、改期；修订检查防止旧页面覆盖新记录。
- 选事情、接数据、选 AI 是独立面板，顶部回今天、底部完成。无所选事情时禁用接数据。
- 记忆解析/预览、导入、ICS、项目、财务、健康、渠道、关注方向继续复用原入口。
- AI 选择为问问、在原来的 AI 里继续、先不用；DSH 不展示问问。已有 AI 进入 AI 与连接。

清单、来源是否有数据、刚采纳的下一步及是否显示引导均由 core 返回，前端不解析原文或计算完成状态。
未改 PRD §6、schemas 或 config.json。补齐 NextItem 的既有 ref 类型声明，与现有资讯建议使用的来源字段一致。

## 接口

独立版均为 `POST /api/product/<方法>`，参数为 JSON 数组，沿用 Host / Origin / X-Kaitu 校验和串行写队列。
DSH 使用同名 Remote 与同一写队列。参数和返回类型见 `OnboardingServices` 与 core 的 onboarding.ts。

| 方法 | 参数 | 回执与用途 |
| --- | --- | --- |
| onboarding | 无 | content、choices、六项 checklist、sources（含 done/skipped）、next、draft |
| onboardingMatterSave | text | 原文 source、text、draft；先保存，不创建任务 |
| onboardingMatterRead | source | 原文及待核对草稿；仅允许已保存 capture，归档后按原文件名查回 |
| onboardingMatterOrganize | source | 独立版经 Ask 整理；无已配置 AI 时返回原文供手工填写。DSH 的整理通过原生会话 |
| onboardingMatterDraft | source、{goal,current,next} | 写 proposed 建议和 Markdown 说明，返回草稿 |
| onboardingMatterKeep | source | 保留原文、撤下未采纳建议 |
| onboardingMatterAdopt | source、{goal,current,next} | 幂等创建一条有原文来源的待办，返回 OnboardingNext |
| onboardingNextChange | id、rev、complete/defer、结果或日期 | 追加任务修订；完成结果进 notes，改期进 due |

原有 onboardingChoose、MemoryPreview/Confirm、ImportPreview/Confirm、SetupPreview/Confirm、Cancel 接口保留。
CLI 增加 `onboarding matter-read <source>`、`matter-draft <source> --json '<草稿>'`。
DSH 的 kaitu_onboarding 增加同名 action。MCP onboarding_status 返回相同的实时状态。

## 实际验证与手动复验

2026-10-16，用构建后的 kaitu ui 共享页面，在两个合成临时工作区验证；引导、Ask、渠道状态均隔离到临时目录。

1. 无 AI：欢迎 → 默认带一件事 → 只保存原文。清单仍为 0/6，无待办。
2. 再带一件事 → 保存并整理。显示未连接 AI 的手工填写说明；修改三项、展开原文、采纳后只出现一条下一步，清单 1/6。
3. 今天卡片改期、刷新、完成并记一句结果，再刷新可读回相同目标、日期、结果和原文来源。
4. 未选事情时接数据不可点击；选项目和资讯后，仅列这两项来源。面板可以返回今天，不要求继续配置。
5. 记忆预览含已知类别和不合格式行；取消一项后只写入两条，回到今天更新清单。
6. AI 面板的「在原来的 AI 里继续」打开 AI 与连接；没有预填凭据。
7. 已连接的合成 Ask 运行时：保存原文 → 返回三项草稿 → 修改下一步 → 采纳，保留用户修改值，刷新不弹欢迎页。

复验沿用以上顺序。用临时状态目录运行，不选择真实工作区。连接 AI 的路径可注入合成 AskRuntime，返回三个字符串，不需要联网或 API Key。

## 验证边界

本次用 kaitu ui 验证共享页面和本地接口，未安装新的 Kaitu.app，也未注册到用户日常 DSH。
合成 Ask 验证会话事件、草稿保存与人工采纳，不代替真实模型输出质量和延迟验证。
手动接续的资料包功能尚未实现，按要求进入 AI 与连接；没有声称已导出资料包。
三名新用户的三分钟任务观察与十分钟成功标准仍需真人验收。

## 检查

只新增一个行为测试，覆盖原文保存不建待办、草稿待核对、采纳来源与去重，并验证改期、结果、归档回读。
既有清单测试改为六条目语义，没有新增快照、文案匹配或常量断言。

补充界面复验：AI 草稿生成后点「只保存原文」，原有待办数量保持 1，pending 草稿为 null，真实 AI 连接回执使清单显示 2/6。
检查 390px 深色今天页，卡片、结果操作、六项清单均可用，无横向溢出。恢复浏览器尺寸和主题模拟后结束验证。
桌面草稿、今天页和窄屏深色截图保存在临时目录 `/tmp/kaitu-launch-{draft,today,mobile-dark}.jpg`，未提交日志或原始数据。

core 与接口提交前：`pnpm build && pnpm typecheck && pnpm lint && pnpm test --maxWorkers=1 --pool=threads` 全部通过，57 文件 / 156 测试。

另以临时构建移除 renderAsk，检查插件形态：顶部三入口、AI 面板只有已有 AI / 先不用；保存后发出当前 AI 的整理提示。
用合成 CLI matter-draft 模拟 AI 写回，界面回读三项；修改下一步后触发外部资料刷新，修改值保持，采纳保存的也是用户修改值。
这项验证覆盖共享组件分支与草稿回读，不等于用户日常 DSH 的原生会话已验收。截图 `/tmp/kaitu-launch-dsh.jpg`。

## 执行期间的 main 变化

开始时最新 main 为 4cb2c3a，已合入，本轮实现按用户消息中明确列出的这版流程。
执行期间 main 另新增 92edcf3，将默认主问题改为「想改变的一件事」，并增加不知道做什么时的 2–3 条路径建议。
这是新的产品扩展，已向用户说明差异；本批没有把它混入当前交审，也没有宣称这次扩展已完成。

界面、技能与文档提交前再次执行同一套四项检查：build、typecheck、lint 通过，57 文件 / 156 测试全部通过。
本轮没有推送，也没有合入 main；临时服务和浏览器验证页面均已关闭。
