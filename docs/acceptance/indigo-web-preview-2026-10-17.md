# 岩山靛、本地问问与建议入口

在 `codex/pr5-local-integration` 的 PR #5 + 本地反馈修改上继续调整，未提交、推送、发布或公证。
已安装并启动 `/Applications/Kaitu.app`，旧 App 移至废纸篓，构建目录不留重复 App。

## 本轮改动

- 岩山靛标志与链接：主色 `#2B4C7E`、深折 `#1B3254`、浅折 `#B8CBE4`。
- 暖纸白 `#FCFCFB`，主按钮用墨色 `#1F1E1D`，深色模式对应反转明暗。
- 待确认日程合并为一张白色卡片，显示数量、逐行分隔、小号确认按钮。其他核对入口收在底部。
- 首页三条下一步及完整列表均改为“让问问帮我”，进入问问并预填事项、来源和补全要求，不自动发送。
- 日程确认原地处理，方向建议进入方向页，足迹核对进入地图，原文核对进入收件箱。
- 本机 Web 复用已安装 Kaitu.app 的 DSH 引擎及模型配置，网页会话单独保存。
  CLI 使用 `KAITU_DESKTOP_APP` 指定 App 路径，默认 `/Applications/Kaitu.app`。

## 运行结果

合成工作区 `/private/tmp/kaitu-indigo-iIVqxG/workspace`，独立 HOME 和 AI 状态目录。

- 点击确认：待确认数量由 4 变 3，日程变为已确认。系统日历关闭，未添加真实日历事件。
- 点击“补全各城市起止时间”的帮助入口：进入网页问问，输入框已带入完整提示词。
- 网页服务成功调用打包的 DSH 凭据助手，返回 9 个提供方选项。
- 创建会话、列表回读通过，默认 `scoped`。未填写凭据、未发送对话，未验证模型实际回答。
- App 构建、打包完成，安装后进程已启动。原生截图受 ScreenCaptureKit -3811 捕获失败阻断。
- 未运行 lint、独立类型检查或测试套件，未新增测试。构建包含必要编译。

截图：[白色确认列表](../../dist/e2e/indigo-preview/confirmation-list.png)、[网页问问与提示词](../../dist/e2e/indigo-preview/web-ask-prompt.png)。
记录：[Web 运行结果](../../dist/e2e/indigo-preview/web-check.json)、[安装记录](../../dist/e2e/indigo-preview/install.json)。

## 极客版发布边界

CLI 已有实现，但 npm 包仍为 private，尚未交付公开安装版。
本轮网页 AI 仍依赖已安装的 macOS App 引擎。独立极客发行需将 DSH 引擎随包提供或按需安装，
并在干净环境验证安装、初始化、CLI、MCP、Web 和对话。当前结果不代表双端已可公开首发。
