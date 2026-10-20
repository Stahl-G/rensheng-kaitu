# 开图 V3 新 Agent 冷读与本地补充验证

2026-10-19 UTC；独立分支 `codex/v3-cold-read-20261019`，起点为 `git fetch origin main` 后的 `e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`。测试者没有项目开发对话背景；没有调用个人上下文或读取个人资料。

## 结果边界

**线上入口冷读未完成**。`https://kaitu.si/developers` 的浏览工具返回不可访问；curl 首次 HTTP 403 / exit 22，重试 CONNECT tunnel 403 / exit 56。首次取时 `2026-10-19 20:21:32 UTC`，HTTP Date `20:22:06 GMT`。响应头、原始失败与原版阶段封存在 [evidence/original-entry.md](evidence/original-entry.md)、`developers*.headers`、`fetched-at.txt`。没有拿到网页 HTML 或当前展示的提示词原文，因此没有伪造网页快照或声称网页和仓库文案一致。[仓库提示词副本](evidence/repository-prompt-NOT-live.md) 仅是 main 上公开 README 的替代材料。

按用户要求继续可验证部分：先遵守仓库 AGENTS.md，读取 GOAL、PRODUCT、HANDOFF，再读取公开 INSTALL、ADD_DEVICE、DATA_LOCATIONS 与模板入口。仓库根没有 `.agents/`；已查看模板中 `skills/kaitu-project-memory/SKILL.md`，诊断阶段另读 `templates/kaitu/.agents/skills/{project,kaitu-project-memory}/SKILL.md`。没有改全局配置或安装 Agent 全局技能。

## 原版说明实验（未修改文档前）

本机有 git、官方 gh、Node 24.19.0，没有 kaitu。`gh auth status` 报环境已有 GH_TOKEN 无效；未打印令牌、登录、生成凭据或调用建库。选择 INSTALL 第 7 步的「没有 kaitu」路径。合成档案为“测试员纸舟”，合成项目为 CSV 导入/导出；未知目标不从真实用户或真实仓库推断。固定合成输入替代访谈，没有模拟真人问答。交接文件名及正文中的 20:30 是合成资料的固定时间，不是实际执行时间；实际时间以抓取时间与生成快照时间为准。

测试远端都是 `/tmp/kaitu-cold-v3/{project,memory,phone}.git` 的普通 bare Git，没有包装 gh/Git，也没有把本地地址冒充 GitHub。模拟 GitHub 建库的步骤直接记为未验，只替换存储远端以验证文件与 Git 行为；所有身份只通过 `git -c` 单次传入。

`local-original.py` 实际创建合成项目、推到 bare 远端、fetch 默认分支并读 HANDOFF/最近提交。来源提交写入项目 STATUS。GitHub PR/issue 未查，记录为未知，不写“没有 PR/issue”。完整日志见 [local-original.log](evidence/local-original.log)。公开说明引用的模板含隐藏文件被复制到临时目录，填档案、目标、规则、STATUS 与日志；上传内容预览见 [synthetic-preview.md](evidence/synthetic-preview.md)，只上传到本地测试远端，未向 GitHub 上传个人资料。

按原步骤第 7 步提交推送，第 8 步按无 kaitu 明确跳过手机生成，第 9 步新建交接，第 10 步查看文件和提交。结果 `git status` 有 `?? handoffs/20261019T2030-cold-agent.md`，第二独立克隆缺这份交接。档案、STATUS、manifest 已从远端回读，副本在 evidence。**这些是普通文件回读，不等于 App 校验通过**：本 Agent 当时还误把 STATUS.updated 写成日期、next 写成字符串列表。

已生成填本地地址的 [第二 Agent 测试提示词](evidence/second-agent-local-prompt.txt)，并实际独立克隆回读。该初始阶段没有启动第二个模型/Agent，也没有声称已验证第二 Agent 的指令遵循或 GitHub 私有性。后续真正的无上下文独立 Agent 补验见 [独立接入与许可澄清后的持久交接](independent-agent.md)。

## 封存后诊断与最小修正

原始阶段记录与 INSTALL/ADD_DEVICE 副本先保留，之后才读 `packages/core/src/{workspace-backup,phone-run,phone-snapshots,init,projects}.ts`、CLI phone 分支和 `schemas/status.schema.json`。

1. **交接漏推送**：第 7 步已推送，第 9 步新文件写完没有明确的最终提交上传。INSTALL 第 9 步补最终 sync 或仅提交本次交接再 push；第 10 步明确从远端回读档案、STATUS、log 和交接。实现中的备份范围能包含 handoffs Markdown，问题无需改代码。
2. **状态格式理解错误**：补充手机实验先直接调用 runPhone，因未 init 报缺 config；这是测试跳过说明前置条件，未据此改产品。按 ADD_DEVICE 先 init 后，原合成 STATUS 报 INVALID_DOCUMENT。schema 要求 updated 为 date-time、next 每项为含 id/title/status 的对象；原公开示例只有占位符和空数组，本 Agent 的日期/字符串填写不合法。DATA_LOCATIONS 仅补充这两个具体格式，保留 schema 与实现。原始错误数据及失败日志均保留，没有用修正数据覆盖原始证据。

## 复验与手机补充实验

- `retest.py` 在第 9 步后提交并 push 交接，再做第三份独立克隆，逐字节核对档案、STATUS、log 和交接，见 [retest-files.txt](evidence/retest-files.txt)。此复验先只验证交接送达，仍保留原 STATUS 数据。
- 诊断阶段才安装官方锁定依赖，`pnpm --filter @kaitu/core... install --frozen-lockfile --ignore-scripts`；XDG 与 store 均指向临时目录（首次默认缓存路径不可写，随后改临时路径成功）。`pnpm --filter @kaitu/core build` 通过。没有安装、发布或更新全局包。
- 手机实验在另一个临时副本，修正上述两项合成格式，按说明先调用真实 `initWorkspace` 接管模板，再调用 CLI phone 分支使用的真实 `runPhone`，不是伪造 CLI 成功输出。init 仅创建本地空 secrets 状态文件，没有生成任何凭据；状态根通过 `KAITU_LOCAL_STATE_DIR` 指向临时目录。档案字节保持不变。直接调用过未 init 的失败和格式校验失败都保留在 `phone-first.log`、`phone-invalid-status.log`。
- `runPhone` 最终返回 `snapshots: 5`，见 [phone-final.log](evidence/phone-final.log)。实际生成 today/week/map/library/receipts JSON，显式加入测试 bare Git 远端后独立克隆回读。全部逐字节核对并 JSON 解析通过，week 内包含“合成纸舟”和“确认 CSV 字段顺序后实现导出”。见 [phone-remote-readback.txt](evidence/phone-remote-readback.txt) 和 [快照文件](evidence/phone-readback/)。初次回读断言把 week.next 当对象而失败，检查真实投影后改为字符串列表断言；未据此改产品。
- 文档改动 `git diff --check` 通过。没有改实现、增加功能或新增文案匹配测试；未跑与两处文档修改无关的全量应用测试。没有 UI 性能变动，因此不以 core 构建或小目录计时冒充大工作区/真机验收。

## 明确未验与剩余阻塞

| 项目 | 状态 / 原因 |
|---|---|
| 当前网页、接入提示词原文、从网页开始的完整冷读 | 阻塞：本环境访问 HTTP/CONNECT 403；未取得正文，不能判断站点本身故障 |
| 创建真实私有记忆仓库、可见性与 GitHub API 同步 | 未验：用户限定本地 bare，且 gh 现有令牌无效；没有尝试登录或建真实仓库 |
| 选中项目的真实 PR/issue 检索 | 未验：只用合成项目和本地 Git，无本地等价 API |
| 原版无 kaitu 路径生成手机内容 | 跳过：原说明要求等待有开图的电脑恢复；没有计为原版成功 |
| 真实 kaitu CLI、App 自动恢复/同步、iPhone 展示 | 未验：本次只执行 core 真实函数与本地 Git，未跑 App/真机 |
| 第二 Agent 接入 | 后续独立 Agent 已实际冷读并写交接；首次未推送，许可澄清后推送并由另一新克隆回读。见 [独立补验](independent-agent.md)；真实设备与 GitHub 权限仍未验 |

脚本绑定 `/tmp/kaitu-cold-v3`，是此次实验的可审计操作记录；需要从干净目录按原版 → 复验顺序运行，勿在已有实验目录重复运行。所有可持久审查的原始响应、日志、回读文件随本报告提交；无需访问测试机临时目录。`SHA256SUMS.initial` 覆盖最初封存的文件；后续证据另附，不修改已封存输入。

## CI 跟进

初始 head `9b0bdc31016e065e1a79d918a40f2f3b3a336029` 的 [CI run 39319397312](https://github.com/Stahl-G/rensheng-kaitu/actions/runs/39319397312) 在 macOS/Windows 的 lint 阶段失败，后续 build/typecheck/test 跳过。失败源于本报告的 3 个操作脚本格式和 2 个原始 JSON 的排版。随后只规范化脚本，并将原始手机快照附件统一用 `.json.txt` 后缀保留，内容字节不变，避免格式化原始证据；没有改 CI 配置、产品实现或最初封存输入。精确新 head 的 CI 结果单独向主线程报告。

## 独立 Agent 补验

用户后续要求启动真正无上下文的独立 Agent，仅给必要入口。首次冷读准确但未推送；先封存原始回答，再仅澄清允许写入指定合成 bare 远端，由同一 Agent 完成真实推送。另一新临时克隆已回读交接并核对 remote main `c01e542e393527b9c0e17d3a052481b682251889`。原始回答、事实对照、许可澄清和回读证据见 [补验报告](independent-agent.md)。这不是原提示词首次无干预全过。
