# 用 DeepSeek Harness 对话记录开图

推荐用 DeepSeek Harness 桌面应用（0.2.0-rc.2）：

1. 安装并打开一次桌面应用，在 **设置 → 模型** 配好模型（DeepSeek、opencode-go 或其他 API Key）。
2. 在开图仓库运行 `pnpm build`，然后：

   ```sh
   kaitu dsh --install
   ```

   它把开图插件写进 `~/.dsh/profiles/desktop/cordis.patch.yml`（只维护 `# kaitu:start` 到 `# kaitu:end` 这一段，重复运行会替换）。
3. 退出并重新打开桌面应用，点 **新会话**，说「今天深蹲 3×12 60kg」。
4. 另开终端运行 `kaitu ui`，在工作台「健康 → 训练」与「历史」看记录和版本。

## 不用桌面应用：网页版

1. 安装 Node.js 22.19 以上的 22.x，或 Node.js 24 及以上版本。在开图仓库运行：

   ```sh
   pnpm build
   ```

2. 首次使用先创建工作区，再生成本机插件配置：

   ```sh
   node packages/cli/dist/main.js init
   node packages/cli/dist/main.js dsh
   ```

   已有工作区跳过 `init`。已配置 `kaitu` 命令时可直接运行 `kaitu dsh`。
   非默认工作区加 `--dir /你的/工作区`，也可设置 `KAITU_DIR`。
   命令只生成状态目录内的 `cache/dsh/cordis.yml`，输出一行启动命令：

   ```sh
   npx @deepseek-ai/dsh@0.2.0-rc.2 web --patch '/本机状态目录/cache/dsh/cordis.yml'
   ```

3. 复制实际输出的命令运行。首次运行 npx 需要联网下载 dsh。
   打开终端给出的本机地址，在 **设置 → 模型 → DeepSeek 卡片** 输入 API 密钥并保存，然后在模型选择器选 DeepSeek 模型。
   操作依据 dsh 的 `docs/user/guide/providers.zh.md`。密钥由 dsh 管理，不填进开图 patch。

4. 另开一个终端，在同一开图仓库运行工作台（自定义目录时两边传相同的 `--dir`）：

   ```sh
   node packages/cli/dist/main.js ui
   ```

5. 在 dsh 对话框输入「今天深蹲 3×12，60kg」。Agent 先查看现状和字段规范，能估算的（份量、热量）直接估算并说明假设，不追问。
   写入成功后，在工作台「健康 → 训练」与「历史」查看记录及版本。
   还可以说「校验一下工作区」或「看最近 5 个版本」。

插件只注册现状、新增单条记录、校验、历史四个工具。补记时间用带时区偏移的 `ts`。
手动配置参见 [cordis.example.yml](../packages/dsh-plugin/cordis.example.yml)，插件路径必须填 `dist/index.js` 的绝对路径。

当前按 dsh `0.2.0-rc.2` 源码与同版 npm 类型实现。
四个对话工具沿用 `tools.register()` 和 `systemPrompt.section()`；总览通过严格生成的 Remote 和 Slots 接入。
已有桌面对话写入结果见 [HANDOFF §0.1](HANDOFF.md#01-现在能用什么均已真机实测)。

## 总览页

构建后运行 `kaitu dsh --install`，退出并重新打开桌面应用，侧栏点「开图」即可查看总览。
页面与四个对话工具使用同一个插件、同一个工作区；网页版同样在 `kaitu dsh` 生成的配置中加载。

总览显示最近 10 个版本、最新每日整理与未决事项、今天的安排、各模块未完成的前 5 条下一步、活跃项目、健康指标和待整理笔记。
点击行可展开对应记录或文件路径；「刷新」重新读取工作区，「问 Agent」返回当前对话。
建议在本页标为待确认，回到对话处理。新工作区显示导入记忆、健康设置与去对话的引导。

健康统计按工作区时区覆盖今天及前 6 天，截止于本次查询时间；睡眠与蛋白质只对有记录日期取日均。
估算数据标「约」，缺失指标显示「暂无记录」，最新体重单独注明测量日期。
项目没有同步提交记录时显示「暂无记录」。版本来源按已有提交说明识别，旧说明无法识别时显示「来源未记录」。
页面使用局部 `--kt-*` 配色，跟随 dsh 的明暗主题，不修改外壳样式。

构建仅使用已安装 npm 包：生成严格 Host/Remote codec，再将浏览器 CJS 封装为 dsh module factory。
rc.2 的生成器只识别工作区中的协议声明，因此构建时在临时目录登记已安装的协议声明，结束后清理；不依赖 dsh 源码目录。
桌面 rc.2 的实际插件扫描、侧栏导航、连接重建与主题切换仍需在桌面应用验收。

本次离线验证：build、typecheck、lint、101 项测试通过；临时工作区中实际 Host 产物加载、descriptor 注册、Remote codec、
client factory 注册与查询、临时桌面 profile 重复安装通过。隔离渲染检查覆盖明暗配色、空状态、来源展开和 320 / 375 像素窄屏；
预览使用临时渲染适配，不代表桌面 dsh 集成已验收。
