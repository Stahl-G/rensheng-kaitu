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

原型依据本地 dsh `57190202`（`0.2.1-alpha.3`）：
`packages/llm/llm/src/types.ts` 定义原始工具参数 schema，
`packages/core/tools/src/index.ts` 定义注册、规范 JSON 返回值和 `output.render`，
`packages/core/system-prompt/src/index.ts` 提供 `systemPrompt.section()`，用于追加开图说明。
没有该服务时，说明回退到 `kaitu_status` 描述。
已做离线工具写入与工作台检查；npm 版 dsh 加载、API 对话尚待实际验证，原 PRD 的 `0.2.0-rc.2` 不在本次兼容性验证范围内。
