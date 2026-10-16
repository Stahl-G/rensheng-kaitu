# 第 6 轮：后端与桌面收尾

## 范围

按用户要求收尾，未新增产品板块，也未改总览页面。
前一批次已提交为 `a38a665`，四项检查通过，126 项测试通过。

- 首次启动 Kaitu.app 询问一次三个自动任务，默认开启，设置菜单可分别开关。
- 默认按工作区时区运行：每日整理 03:00、早间计划 07:30、资讯搜索 08:00。
- 已有任务回执保留，不覆盖自定义时间和内容，不在重启时补回用户手动删除的任务。
- 开关关闭时保存原任务内容和规则，再打开时恢复。复用 DSH 原生 schedule 服务。
- 只有 Kaitu.app 关闭 API Key 自动引导，直接 DSH 入口恢复该引导。
- 总览数据新增非空 `sections`，缺失健康指标从 `metrics` 中省略，真实零值保留。
- 主窗口管理单个 AI 子进程，重复点击复用，子进程隐藏 Dock 图标，退出主窗口时一起清理。
- 沿用原 AI 状态目录，不移动或删除既有登录和会话。
- 清除验收目录 16 份原始日志和数据载荷，保留简要结果与截图。

## 前端可用的数据接口

`overview.sections`：`{ id, label, count, latest }[]`，只含有实际资料的板块。
`count` 是板块记录/对象数量，不是进度或评分。`latest` 未记录时为 null。
`overview.metrics`：只含当前统计范围有数据的指标，时间序列缺失日仍为 null。

`automation` 返回 `{ asked, tasks: { morning, organizer, news } }`。
`configureAutomation` 接受三个布尔开关的部分更新，保存确认与开关。
以上接口在本地 product API 和 DSH Remote 共用 core 的配置读写。
设置更改由运行中的 DSH 任务服务在 5 秒内读取并应用。

## 验证

使用隔离资料和状态目录，测试输出保存在 `/tmp/kaitu-review-*.log`，不提交。
新增两个行为用例：任务生命周期、真实子进程复用与正常退出。
总览原有行为用例扩展为空板块与真实零值验证。
首次完整检查：build、typecheck、lint 通过，43 个文件、128 项测试通过。
DSH 与 Kaitu.app 的生成配置经过 YAML 实际解析，credentialOnboarding 分别为 true / false。
隔离桌面真实创建三个任务，原生菜单关闭早间计划后，DSH 回执 applied.morning=false，原时间规则保留。
重复点击内置 AI 后只有一个子进程，系统进程元数据显示主窗口 policy=0、AI policy=1，AI 无 Dock 项。
首次关闭主窗口发现 macOS activate 事件访问已销毁窗口的错误；已补销毁检查。
重新打包后，Computer Use 看到首次任务询问；确认后生成任务回执，重启不再询问。
点击关闭主窗口后主进程与 AI 子进程全部退出，无错误弹窗，桌面进程退出码为 0。
重启同一资料，再次启动同一应用时仍只有一个资料主进程和一个 AI 子进程。
最终 build、typecheck、lint 全部通过，43 个文件、128 项测试通过。

桌面产物：`dist/prd-backend-review-fixed/Kaitu.app`，ASAR 自检和深层严格签名校验通过。
实际运行副本在 `/tmp/kaitu-review-fixed/Kaitu.app`，仅修改 bundle ID 并重签名以隔离机器上的其他开图实例。
验收结束已关闭隔离实例，原个人资料预览服务保持运行。

## 交审

第 5 轮和本轮分别提交到 `codex/kaitu-prd-completion`。不推送、不合并 main。
原 PRD 的其他缺口保留在功能账本，本轮不继续扩展。
