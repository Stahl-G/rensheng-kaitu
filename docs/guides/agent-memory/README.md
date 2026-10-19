# 开图私人共享记忆：跨设备、系统和 Agent

[短初始化入口](COPY_TO_YOUR_AGENT.md) 让 Agent 建立私人记忆骨架和当前 Agent 薄入口，从已知上下文与短对话整理偏好、目标和事情，在个人内容写入上传前一次确认。可以零项目、零目标或暂不填个人内容；本机项目发现、GitHub repo 和资料导入只是可选填充，不得阻塞初始化。

[完整规则](INSTALL.md) · [第二设备/Agent](ADD_DEVICE.md) · [存放位置](DATA_LOCATIONS.md) · [实际使用](USER_TEST.md)

默认 PRIVATE kaitu-ai-memory，自动采用明确账号和安全新目录；有歧义才询问。已有任何仓库和文件保留不覆盖、不自动迁移。普通只读不反复确认，官方新增授权、安装及系统权限正常处理。已有可用 kaitu 可复用，没有则普通 Git/官方 gh；不要求 App、Node、Python、MCP 或新 runtime，不改全局配置，不虚构 Gitee 镜像。

```text
请读取并执行 https://github.com/Stahl-G/rensheng-kaitu/blob/9c66f1011a4c21b1a1da8556277297138c5b805e/docs/guides/agent-memory/INSTALL.md ，帮我建立跨设备、系统和 Agent 的私人开图共享记忆。先自动检查工具、现有登录、账号和安全新目录，默认 kaitu-ai-memory。先整理已知上下文，通过简短对话补偏好、目标和事情，可跳过；没有项目也要能完成记忆骨架与当前 Agent 入口。项目或资料只是可选填充，可来自本机、我指定的 GitHub repo 或文档，不扫描其他设备或账号。复用既有 me/memory/projects 格式，不造平行体系；个人内容写入上传前合并确认一次。保留已有仓库和文件，正常处理官方授权，不改全局设置、不装新运行时，最后回读同步并生成填好真实地址的第二设备接入提示词。
```

## 同一份个人资料

[template/](template/) 是实际零项目模板：me/profile.md、me/rules.md、空 me/goals.json/ongoing.json、me/STATUS.md、memory/MEMORY.md、projects/module.json、OVERVIEW、AGENT-README、根 AGENTS/CLAUDE、inbox/agents、handoffs 和许可。没有 projects/example-project。只有添加项目时才参考 [可选项目例子](examples/project/STATUS.md)。

偏好用既有 memory/preference_<slug>.md 与索引，目标用 me/goals.json，作息与时区用 me/rules.md，档案用 me/profile.md；详情见 DATA_LOCATIONS。空值表示未知，不猜个人背景，不建 USER/根 MEMORY/PROJECTS 平行体系，不上传源码、完整对话或凭据。普通后续 Agent 追加候选/交接，不擅改正式内容；未安装的整理器、App 索引和手机功能不宣称已启用。

## 来源与许可

安装、第二设备与薄适配思路参考并改写自 [Cody Qin / shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)：[INSTALL](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/INSTALL.md)、[ADD_DEVICE](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/ADD_DEVICE.md)、[shared-memory skill](https://github.com/CodyQin/shared-ai-memory/blob/main/skills/shared-memory/SKILL.md)。其 MIT 署名与许可完整保留在 [LICENSE.shared-ai-memory](template/LICENSE.shared-ai-memory)。目录、权限及 handoff 内容适配开图现有 `overview.ts`、`status.schema.json` 与 `projects.ts`，没有变更数据规范。
