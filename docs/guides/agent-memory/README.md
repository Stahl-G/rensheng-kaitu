# 开图私人共享记忆

开图帮你把偏好、目标和选中项目的进度、决定、失败尝试整理进你自己的私有 GitHub 仓库，都是普通 Markdown，你随时能看能改。换电脑、换编程 Agent 时，先让它读这份记忆，少重复解释背景，直接接着做。不需要装开图 App，任何能操作文件和终端的 Agent 都行。

把下面这段交给 Agent：

```text
请帮我建立一套基于「开图」的个人 AI 记忆，让我在不同电脑、不同编程 Agent 之间都能接着工作。不要只给教程，请实际完成。

按这份说明做：https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/guides/agent-memory/INSTALL.md

· 在我的 GitHub 账号下新建私有仓库 kaitu-ai-memory，已有的仓库和文件一律不动。
· 登录只走 GitHub 官方授权，不要向我要密码、token 或验证码。
· 先根据你已知的信息整理我的偏好和目标，再简短问我几个问题，我可以跳过。
· 如果我想接入项目，你自己读项目文档和最近的提交来整理进度，不要让我填。
· 写入和上传前给我看一次要保存的内容，我确认后再做。
· 做完后给我一段填好仓库地址的提示词，我拿去给另一台电脑或另一个 Agent 用。

先用三句话说明计划，然后开始。
```

另一台电脑或新的 Agent：

```text
请按 https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/guides/agent-memory/ADD_DEVICE.md 接上我的开图私人记忆 <仓库地址>，读完告诉我你记住了什么，然后接着做我交代的事。
```

想在开图 App 里看：打开「设置 → GitHub 同步」，从这个仓库恢复到一个新文件夹。

[内容放在哪](DATA_LOCATIONS.md) · [初始模板](template/)

安装和第二设备的思路改写自 [Cody Qin / shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)，MIT 许可见 [LICENSE.shared-ai-memory](template/LICENSE.shared-ai-memory)。
