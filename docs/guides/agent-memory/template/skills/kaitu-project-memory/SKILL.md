---
name: kaitu-project-memory
description: 用普通文件和 Git 读取指定项目的开图记忆；结束时追加既有格式的交接，不依赖 App 或 kaitu CLI。
---

只使用用户指定的记忆仓库和一个代码项目。先读记忆仓库 AGENT-README.md，安全拉取，再读该项目 STATUS.md/log.md 及较新的 handoffs/。事实必须指向这些来源，候选不当作已采纳。

结束时只新建唯一 inbox/agents/*.note.md 或 handoffs/<时间>-<agent>-<唯一后缀>.md，沿用 agent/at/follows 与“做了什么 / 当前下一步 / 未决或需要用户”结构；写改动、失败尝试、阻塞、完整下一步与来源。保留已有摘要、STATUS/log、代码和配置。检查暂存文件后正常 Git 推送，核验远端提交；冲突保留双方，不强推。

不调用 kaitu，不安装 Node/Python，不修改全局设置，不扫描其他项目，不复制凭据。项目技能可选安装到用户确认的当前代码项目，正常审批且保留同名冲突。安装模板不等于新 Agent 接续验证完成。
