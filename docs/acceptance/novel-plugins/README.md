# DSH 小说插件本地验收 · 2026-10-16

## 交付

分支 `codex/novel-sf-plugins`，基线 `92edcf310cf0b806dce21d283ca8631222134a6f`。原工作树及其已有改动保持原状。DSH 0.2.0-rc.2 / Cordis 4.0.4；MIT。

两个插件：`packages/novel-plugin`（kaitu-novel-workspace）、`packages/sf-plugin`（kaitu-sf-consistency）。共享实现为 `packages/core/src/novel`。使用原生 Cordis tools、systemPrompt、service 和 Typert remote；独立启停，科幻服务依赖小说数据服务。没有新增独立 App。

全文阅读 Library PRD v0.1，之后按用户明确修订实施：Agent 自行 grep/read 找资料；保留只读和可选续写；不包装宿主通用文件工具；规则写入 AGENTS.md。世界书导入、来源定位、作品状态、资料提案批准与撤销、写作交接、候选稿及合稿撤销由插件保存。

打包入口：`pnpm --filter @kaitu/core build`，`pnpm --filter kaitu-novel-workspace build`，`pnpm --filter kaitu-sf-consistency build`，`npm_config_cache="$PWD/.novel-run/npm-cache" node scripts/pack-novel-plugins.mjs`。

输出为 `dist/novel-plugins/kaitu-novel-workspace-0.1.0.tgz` 和 `kaitu-sf-consistency-0.1.0.tgz`，附带 bundled dependency licenses。尚未发布 npm 或市场；本机预览 http://127.0.0.1:4887/，隔离配置在忽略目录 `.novel-run`。

## 实际模型复验

使用用户在隔离 DSH 配置的 DeepSeek-V41-Flash / High，通过 DSH 正式 headless 入口执行，没有读取密钥。

- 自动查版本说明、正文、世界书，导入 48 条世界书设定卡（46 条原文摘录、2 条待定）。
- 对《训练与选拔》的“抛物线飞行”对照世界书，保存两条带出处的意见：低重力动作相容的合理性提示，以及“失重/模拟月球重力”用词歧义的缺条件提示。没有生成确定冲突。月面重力直接使用 NASA 1.62 m/s²，没有索要作者定义或无关质量参数。
- 续写采用真实作者片段作风格参考，在隔离合成作品里保存独立候选《夜班之后（候选）》，约 200 字，没有合入原稿。
- 前几轮实测暴露了引用 hash、小说/SF 修订号混淆和模型传场景标题的问题。现由插件构造引用与取得当前修订号，并接受唯一标题或“文件#标题”；修正后两条意见和续写候选均实际保存成功。私有逐步轨迹留在 `.novel-run`，不随代码提交。

## 验证

全量 58 个测试文件、157 个测试通过。后续场景引用/草稿关联修正后，两个相关工作流测试、两插件类型检查、lint、构建和本地打包重过。

两个工作流覆盖真实文件的索引/交接、批准撤销、源文变更、并发修改、改名、只读与合稿撤销；以及单位换算、低重力计算、缺条件、虚构例外、历史规则、陈旧锚点、世界书重复导入。

最终逐文件核对：真实作品正文/设定目录内 34 个 Markdown/TXT/DOCX 文件，SHA256 和 mtime 全部未变；隔离合成作品两个文件同样未变。真实作品只读，合稿与撤销只对临时合成文件验证。运行使用隔离 HOME、DSH_HOME 和开图工作区。

## 主线接口核对

已读取 PR #4 合并提交 `69efc94a28aed6faf02a5e8f96a7535df0a2c62b` 的差异。本分支不改接续、引导和同步实现，不重置主线文件。重叠处为 core/index.ts 的新增导出、projects.ts 将已有 docxText 导出；合并时保留双方新增项。主线 readProject、listProjects、stateDirectory 的所用签名保持可用，但本轮完整运行基于上述独立基线，未声称已在最新主线全量验证。

## 范围

当前以试用闭环为限：更完整的虚构历法、关系网络、DOCX 原位合稿、全书批量评测和持续文件监听未实现。可选续写沿用 Write Like Me 的“先读作者样本再匹配风格”方法，没有声称接入不存在的 DSH SDK。

## 浏览器实测

浏览器为 ChatGPT in-app browser。本轮实际打开工作台、合成作品及续写候选页；最终精简界面已加载，候选正文与模式开关显示正常。`01-workspace.jpg` 为早期合成作品交接闭环；`02-candidate.jpg` 为最终界面及真实模型候选。不提交真实书稿截图。
