# 任务：阶段 2 第 1、3 项——kaitu 专用 profile（开图 kaitu）

先读 `docs/HANDOFF.md` §0、`docs/PRD.md` §10 阶段 2、`docs/dsh.md`、`packages/cli/src/dsh.ts`。DeepSeek Harness 0.2.0-rc.2 源码在 `<DSH 源码目录>`：读 `docs/architecture.zh.md` 里 profile 与 bundle 的部分、`.agents/notes/implemented/architecture/` 下 profile 相关笔记、`docs/config-catalog.zh.md`，确认怎样新建 profile、禁用插件、限制文件读写目录。不联网、不提交、不加依赖。

## 背景
用户在桌面应用里用开图时，Agent 有时绕过开图工具，直接用 shell 读文件。PRD 要求单独的 kaitu profile：禁用产品埋点、遥测、终端、shell、浏览器操控、电脑操控、SSH、LSP、DeepSeek 账号登录、Agent Teams、工作流等插件，文件读写限定在开图工作区。

## 要做
1. 确认 rc.2 的桌面应用能否切换或新建 profile。不能的话确认 `dsh web --profile kaitu`（或等价参数）是否可用，选用户最省事的一种。
2. 实现 `kaitu dsh --install --profile kaitu`（或改为默认）：生成 kaitu profile 的 `cordis.patch.yml`，插入开图插件，禁用上面列的插件，把文件读写限制在工作区。禁用项用 rc.2 里真实存在的插件 id，逐个在源码里核对，并在汇报里列出对照表。
3. 不动用户已有的 desktop / web profile，只维护 kaitu profile 里的开图段落；重复运行结果一致。
4. 文档 `docs/dsh.md` 更新启动方式；HANDOFF §0.4 第 2 项与 GOAL 各一句。

## 测试（只写必须的）
一个测试：在临时 `DSH_HOME` 上运行安装，生成的 YAML 可解析，包含开图插件与禁用项，重复运行不变。

## 完成标准
四项检查全部通过；中文简短汇报：profile 机制依据、禁用对照表、用户启动方式、只能真机验证的项（shell 确实不可用、文件范围确实生效）。
