# 任务：阶段 2 第 2 项——最小「今天」页面插件（开图 kaitu）

先读 `docs/HANDOFF.md` §0、`docs/PRD.md` §5.1 与 §10 阶段 2、阶段 3、`packages/web`（现有 Preact 工作台的「今天」页与接口）、`packages/dsh-plugin`。DeepSeek Harness 0.2.0-rc.2 源码在 `<DSH 源码目录>`：读 `docs/architecture.zh.md` 客户端插件部分、`docs/cookbook/adding-a-settings-card.zh.md`、`docs/subsystems/` 下与 client / slots / pages 相关的文档，以及一个注册全局页面的内置客户端插件源码（如 `packages/client/ui-deliverables` 或 schedule 的「自动化任务」页面）。不联网、不提交。

## 目标
只验证能力，不打磨样式：在 dsh 桌面应用侧栏出现「今天」入口，页面显示开图工作区今天的现状（复用 core 的 status / NOW 数据），能换应用标题和品牌名。正式界面在阶段 3 由 Claude Design 重做。

## 要做
1. 确认 rc.2 第三方客户端插件的打包与加载方式（React？构建产物格式？是否需要 dsh 的客户端包作为 peer 依赖，npm 上能否装到）。需要新依赖时停下，在汇报里列出包名和版本，由 Claude 安装后再继续。
2. 在 `packages/dsh-plugin` 或新包 `packages/dsh-ui` 里实现最小页面插件，服务端数据走开图插件新增的 RPC 或已有工具，不另写读写逻辑。
3. `kaitu dsh --install` 一并装上页面插件。
4. 文档 `docs/dsh.md` 一节；HANDOFF §0.4 第 3 项与 GOAL 各一句。

## 测试
不写 UI 测试；最多一个测试覆盖新增数据接口。

## 完成标准
四项检查全部通过；中文简短汇报：客户端插件机制依据（源码路径）、做了什么、用户怎么看到、只能真机验证的项。若 rc.2 第三方插件无法注册页面，写清证据，这是阶段 2 的否决项。
