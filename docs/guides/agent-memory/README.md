# 开图私人共享记忆

开图帮你把偏好、目标和选中项目的进度、决定、失败尝试整理进你自己的私有 GitHub 仓库，都是普通 Markdown，你随时能看能改。换电脑、换编程 Agent 时，先让它读这份记忆，少重复解释背景，直接接着做。不需要装开图 App，任何能操作文件和终端的 Agent 都行。

把下面这段交给 Agent：

```text
帮我在 GitHub 上建一个私人 AI 记忆库，让我换电脑、换 Agent 时不用重新介绍自己和手上的项目。请直接做完，不要只给教程。

照这份说明做：https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/guides/agent-memory/INSTALL.md

- 仓库必须是私有的；我已有的仓库和文件不要动。
- 登录只走 GitHub 官方页面，不要问我要密码、token 或验证码。
- 我的偏好和目标，先用你已经知道的整理，再问我最近都在推进什么，最多三个问题。
- 我提到的每个项目，你自己读最新的文档、提交和开着的 PR，写出做到哪、卡在哪、下一步。
- 上传前把要保存的内容给我看一次。

先用三句话说明计划，然后开始。做完给我一段话，我贴给另一台电脑或另一个 Agent 就能接上。
```

另一台电脑或新的 Agent：

```text
请按 https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/guides/agent-memory/ADD_DEVICE.md 接上我的开图私人记忆 <仓库地址>，读完告诉我你记住了什么，然后接着做我交代的事。
```

想在开图 App 里看：打开「设置 → GitHub 同步」，从这个仓库恢复到一个新文件夹。

[内容放在哪](DATA_LOCATIONS.md) · [初始模板](template/)

安装和第二设备的思路改写自 [Cody Qin / shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)，MIT 许可见 [LICENSE.shared-ai-memory](template/LICENSE.shared-ai-memory)。
