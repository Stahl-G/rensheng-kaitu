# 任务：Kaitu 品牌插件 + 开图专用 profile

dsh 0.2.0-rc.2 源码在 `/Users/yihongguo/Developer/deepseek-harness-rc2`（只读）。必读：`packages/client/ui-brand-official`（README 和源码）、`packages/client/ui-sidebar`（看它声明的 `sidebar.brand.mark`、`sidebar.brand.name` 插槽，以及侧栏还有哪些入口、各由哪个插件注册）、`packages/client/ui-conversation`（看 `conversation.hero.brand.mark`）、`BRAND_GUIDELINES.zh.md`，以及 profile 和 `cordis.patch.yml` 的格式说明（用 grep 在 `docs/` 和 `packages/boot`、`packages/preset` 里找 patch 支持哪些操作：insert、remove、disable、替换配置等）。
开图现有的插件在 `packages/dsh-plugin`，`kaitu dsh --install` 写入的是 `~/.dsh/profiles/desktop/cordis.patch.yml` 里的 `# kaitu:start…end` 段。不联网、不提交。

## 目标
在 dsh 桌面应用里：侧栏左上角显示 Kaitu 标志和名称，对话首屏也换成 Kaitu 标志；侧栏底部「设置」旁边或设置页里写一行「Powered by DSH」（按品牌规范只用缩写 DSH，不用 DeepSeek Harness 全名）；隐藏开图用不上的入口。

## 要做
1. **品牌**：在 `packages/dsh-plugin` 的 client 入口里，占住三个品牌插槽，或者在必须单独成包时新建 `packages/dsh-brand`，选更简单的那种。标志用 `docs/design/kaitu-mark.svg`（六边形立方体轮廓 + 中心蓝点，线条用 currentColor，深色模式蓝点改用 `#7FA2F0`），侧栏入口「开图」的图标也换成它。名称为「Kaitu」。
2. **撤掉官方品牌**：查清怎么让 `ui-brand-official` 不生效，可能是 profile patch 移除或禁用插件、改构建 profile，或者别的方式。只有用户本机 profile 能做到的方式才算数。如果桌面版官方构建做不到，写清楚依据，留到第二步打包时处理。
3. **隐藏入口**：列出侧栏和顶栏现有的全部入口及其来源插件，然后给出建议：哪些保留（新会话、开图、设置、会话列表），哪些隐藏（插件市场、工作区管理、账号相关、埋点相关）。能用 patch 关掉的，就写进 `kaitu dsh --install` 生成的段落；关不掉的列出原因。**这些改动只能写在 kaitu:start…end 段里**，不能动用户 profile 的其他部分。
4. **Powered by DSH**：找一个能放这行字的插槽（设置页、侧栏底部或「关于」），放上去。写成「Powered by DSH <版本号>」，版本号读取当前实际运行的 dsh 版本，不写死。
5. 文档：`docs/dsh.md` 加一小节「Kaitu 品牌与入口」。

## 测试
不写 UI 测试。如果 `--install` 生成的 patch 段有变化，就更新现有的 cli 测试，或者只加一个断言。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。用中文汇报三到五行：每项做到了没有，做不到的写依据（源码路径），桌面打包时需要处理的列成清单。不写免责声明。只改当前 worktree，不碰 `~/.dsh`。
