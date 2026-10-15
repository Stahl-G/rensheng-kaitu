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

总览显示最近 10 个有意义的改动版本、最新每日整理与未决事项、今天的安排、各模块未完成的前 5 条下一步、活跃项目、健康指标和待整理笔记。
点击行可展开对应记录或文件路径；「刷新」重新读取工作区，「问问开图」返回当前对话。
建议在本页标为待确认，回到对话处理。新工作区显示导入记忆、健康设置与去对话的引导。

健康统计按工作区时区覆盖今天及前 6 天，截止于本次查询时间；睡眠与蛋白质只对有记录日期取日均。
估算数据标「约」，缺失指标显示「暂无记录」，最新体重单独注明测量日期。
项目没有同步提交记录时显示「暂无记录」。版本来源按已有提交说明识别，无法识别来源时留空。维护类版本不在总览显示，完整历史仍保留。
页面顶部提供「今天、健康、在做的事、资讯、关于我」板块，收起状态保存在 localStorage；当前「今天」有内容，其余显示建设中提示。
健康卡片使用 7 天训练方块、睡眠柱图与目标线、蛋白质进度和估算斜纹；缺失睡眠保留虚线框，体重缺失时可点「记一次」去对话。
目标来自 me/rules.md 的作息和营养规则；每天的缺失值为 null，真实零值保留。项目柱图使用每日字数增量或提交数，浅紫槽固定高度。
「需要你处理」仅显示非零项目，全零时隐藏。页面使用局部 `--kt-*` 配色，跟随 dsh 的明暗主题。

### rc.2 品牌能力（本次仅核对）

rc.2 支持通过第三方 client 插件替换侧栏品牌名和标识：占据 `sidebar.brand.name`、`sidebar.brand.mark` 两个公开 Slot，
并在 profile 的插件组合中停用官方品牌插件、加载替代插件；没有一个 profile 的 appName / logo 参数能完成这件事。
依据为本机同版源码的 [Slot 声明](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-sidebar/src/client/index.ts:76)、
[官方品牌注册实例](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-brand-official/src/client/index.ts:17) 和
[品牌包的替换说明](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-brand-official/README.zh.md:34)。

浏览器 / 页面窗口标题由构建时的 `DSH_CLIENT_TITLE` 控制（[AppFrame](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-layout/src/client/AppFrame.tsx:233)）；
桌面安装包应用名和图标由打包配置指定（[productName](/Users/yihongguo/Developer/deepseek-harness-rc2/apps/desktop/scripts/electron-builder-config.mjs:109)、
[macOS 图标](/Users/yihongguo/Developer/deepseek-harness-rc2/apps/desktop/scripts/electron-builder-config.mjs:151)），不能只靠运行时 profile 更名。
本次没有注册品牌或设置 Slot，也没有修改 dsh profile 与外壳。

构建仅使用已安装 npm 包：生成严格 Host/Remote codec，再将浏览器 CJS 封装为 dsh module factory。
rc.2 的生成器只识别工作区中的协议声明，因此构建时在临时目录登记已安装的协议声明，结束后清理；不依赖 dsh 源码目录。
第一版已在 dsh 桌面 rc.2 实测加载成功。
本轮按两份最终设计稿调整，仅修改当前 worktree，没有新增依赖、提交或改写桌面 profile。

本轮验证：build、typecheck、lint、101 项测试通过，仅更新已有 overview 测试，覆盖逐日缺失 null、真实零值、同次训练去重、
睡眠按结束日期归日，以及项目字数增量与提交数。隔离预览使用临时合成工作区与 Preact / Button 渲染适配，
检查了有数据、空状态、板块占位与返回、收起状态刷新保留、明暗配色、缺失睡眠框、体重记录按钮、项目产出槽和 375 像素排版。
维护版本过滤与云端 Agent 名称提取通过实际 core 查询检查；没有新增 UI 测试。
