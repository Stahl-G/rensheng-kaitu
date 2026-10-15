# dsh「开图总览」第 1 段可行性确认

核对日期：2026-10-15。依据为本机 `deepseek-harness-rc2` 的 `0.2.0-rc.2` 源码，未联网查询 npm。

结论：**rc.2 允许第三方插件增加全局页面与侧栏入口，没有触发否决项。需要新增依赖，本次停在第 1 段。**
建议在现有 `packages/dsh-plugin` 内增加 client 入口，沿用一个安装项、一个 workspace 配置和已有四工具。
本次仅新增这份说明及 `/tmp/kaitu-dsh-deps.txt`，尚未实现页面或运行四项实现验收。

## 1. 包声明与浏览器产物

第三方包需由 Host Loader 启用，并有包名、Host 入口、`dsh.client.platform: "web"`、`exports["./client"]`。
`dsh.client.inject` 使用依赖插件的包名，client 源码的 `inject` 使用 Cordis 服务名，两者不同。
`external` 只声明共享基座之外的运行时模块请求，本页不需要额外 external。
`immediately` 可省略，普通页面不用进入内核预加载阶段。

建议的关键声明如下，保留现有 `dist/index.js` Host 入口，类型与生成物按 Typert 的 `lib/` 约定输出：

```json
{
  "name": "@kaitu/dsh-plugin",
  "type": "module",
  "main": "dist/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./dist/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./dist/client.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
    "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ]
    }
  },
  "files": [
    "dist/", "lib/types/",
    "lib/typert.host.js", "lib/typert.host.d.ts",
    "lib/typert.remote-client.js", "lib/typert.remote-client.d.ts"
  ],
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.4" }
}
```

`./types` 留给纯数据契约，不让浏览器导入 Host 实现。保留现有 `private: true`，本任务不涉及发布。
`files` 与生成物 export 是为完整产物准备，其中 Typert generator 会核对精确的文件条目。

Client 产物是一个浏览器脚本，内部为 CJS，外层注册惰性 factory；不能直接把 ESM 或裸 CJS 文件交给 dsh：

```js
window.__ModuleLoader__.load({
  id: "@kaitu/dsh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // 打包后的 CJS 代码，导出 apply 与 inject。
    return module.exports;
  }
});
```

React、`react/jsx-runtime`、`react-dom`、`react-dom/client`、Cordis、client-store、ui-slots、ui-primitives、ui-dockkit
由外壳共享。构建时将用到的这些 specifier 标成 external，factory 内通过 `require()` 取得同一个实例。
不把 React 或 primitives 再打进插件，不通过全局 React、CDN 或 import map 引用。
其他功能包只做 `import type`，跨插件行为用服务注入。`clsx`、生成的 Remote contribution 与其 Zod codec 打进 client bundle。
CSS Modules 编译成类名映射与 CSS 文本，在 factory 内插入带 `data-plugin`、`data-plugin-css` 标识的 style，供卸载清理。

源码依据：

- [扫描与绝对路径包定位](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/modules/src/index.ts:824)：
  最近的 manifest 决定包身份，没有限定 `@deepseek-ai` 包名。
- [内置插件包声明](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-schedule/package.json:15)。
- [CJS、CSS 与 factory 构建约定](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/tsdown.client.ts:475)。
- [共享模块基座](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/web/src/platform.ts:9)。
- [模块文档](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/modules/README.zh.md:32)。

**能否只依赖 npm 包构建：源码表明可以，不需要改动或链接 dsh 仓库。**
上述包都有公开 exports 与发布声明；Typert generator 公开 `WorkspaceTypertGenerator`、`WorkspaceAnalyzer` 和 emitter。
它可以把当前开图仓库作为分析根目录，Host aggregate 只引用本仓库的 dsh-plugin 项目。
先生成 Host reflection 与 Remote codec，再编译 client。不使用 dsh 根构建脚本，也不导入其仓库私有 preset。

`packages/client/tsdown.client.ts` 是仓库级相对路径构建辅助文件，不能当作 npm SDK 导入。
本页用一个小型 esbuild 脚本实现上面的固定 wrapper，并用 lightningcss 处理 CSS Modules，无需新增 tsdown、Vite 或 ReactDOM 入口。
generator 只按 `lib/`、`lib/types/` 映射源码，因此 Host 类型改在 `lib/types/` 输出，Host JS 仍生成到原来的 `dist/index.js`。
Host 与 client 使用独立 tsconfig，防止两侧 Context 合并相互污染。

依据：[generator 公开入口](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/generator/src/index.ts:8)、
[workspace 生成与 exports 校验](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/generator/src/workspace.ts:32)、
[源码路径映射](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/generator/src/analyzer.ts:2874)、
[npm 发布配置](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/generator/package.json:4)。
这些是源码支持的构建路径，npm 上精确版本的可下载性及发布产物完整性留给 Claude 安装时确认。

## 2. 页面、侧栏与注入服务

| 位置 | 接口 | 本页注册 |
| --- | --- | --- |
| 主区 | root scope、keyed Slot `main` | `key: "kaitu-overview"` |
| 侧栏 | root scope、list Slot `sidebar.panellist` | 同名 `id`、`label: () => "开图"`、图标 |
| 生命周期 | `ctx.slots.inject(slot, callback)` | owner 出现后 `ctx.slots.register()`，卸载自动撤回 |
| 页面数据 | 注册项的 `inject` | 返回查询/刷新 callback 或 observable，不向组件传 `ctx` |

Client 装配需要 `slots`、`remote`。先 `await ctx.remote.$mount(本插件生成的 contribution)`，保留其 disposer。
实际调用查询的 UI 子插件再声明 `inject: ["slots", "remote", "remote.kaitu"]`，使用 `ctx.plugin()` 安装。
不能让装配入口一开始等待自己尚未挂载的 `remote.kaitu`。
只读总览不需要 Session、Workspace、右侧栏、conversation 或 locale 服务。
侧栏现有 owner 已提供选中、点击、折叠和 `layout.selectPanel()`，本页不用再造导航。

依据：[定时任务页注册](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-schedule/src/client/index.ts:168)、
[侧栏元数据与选择回调](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/client/ui-sidebar/src/client/index.ts:49)、
[Slot 输入和生命周期](/Users/yihongguo/Developer/deepseek-harness-rc2/docs/subsystems/slots.zh.md:13)。

## 3. Host → Remote → 页面

Host 暴露一个根服务 method，不依赖 Session。签名示意如下，`readOverviewData` 是第 2 段拟放在 core 内的聚合函数：

```ts
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

export class KaituOverviewService extends TypertRemoteService {
  constructor(ctx: Context, private readonly ws: Workspace) {
    super(ctx, "kaitu");
  }

  @Remote("overview")
  async overview(): Promise<OverviewData> {
    return readOverviewData(this.ws);
  }
}
```

构建生成 `lib/typert.host.*` 与 `lib/typert.remote-client.*`，数据契约从本包 `/types` 导出。
Client 显式挂载自己的 `/remote` contribution 后，调用 `ctx.remote.kaitu.overview()`。
该 API 返回 `RemoteResult<OverviewData>`，页面处理 `ok/value` 与失败分支，并保留手动刷新入口。
组件通过 Slot `inject` 接收查询能力，数据只在 Host 调用 core，浏览器不访问文件系统。

**现有安装方式有一处必须处理：**`packages/cli/src/dsh.ts` 用绝对路径加载 `dist/index.js`。
Client Modules 支持它，但 Typert Loader 的 `resolveArtifact()` 排除带路径的 entry 名，不能指望自动发现 `/typert`。
沿用该安装方式时，在 Host 插件注入 `typert`，通过公开的 `ctx.typert.register()` 显式注册生成的 Host contribution，
将注册绑定到插件 effect。若未来改为 npm 包名加载，再切换为 Loader 自动注册，避免双重注册。

依据：

- [Host Remote 实例](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/schedule/schedule/src/index.ts:303)。
- [服务绑定](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/protocol/src/index.ts:166)。
- [Client 显式装配](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/api/remotes/src/client/index.ts:203)。
- [Typert Loader 对路径的限制](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/loader/src/index.ts:324)。
- [公开的手动注册接口](/Users/yihongguo/Developer/deepseek-harness-rc2/packages/typert/registry/src/service.ts:502)。
- [严格生成与 SRC 回退边界](/Users/yihongguo/Developer/deepseek-harness-rc2/docs/api-gateway.zh.md:132)：
  不能只加 decorator 而省略 Client codec，也不能让 client 调用回退为无校验的传输。

## 4. core 数据复用与待补项

| 需求 | 现有依据 | 第 2 段处理 |
| --- | --- | --- |
| 10 个版本 | `history.ts` 的 `history(ws, { limit: 10 })` | 在 core 中补来源投影，保留原始说明 |
| 最新每日整理 | `overview.ts` 的私有 `latestDaily()` | 导出可复用查询并统计「未决事项」，排除空白、已完成项与「无」 |
| 今天与下一步 | `status.ts` 的 `readStatus()` | 用 blocks、pending、modules；每模块保留 todo/proposed 的前 5 条 |
| 活跃项目 | `projects.ts` 的 `listProjects()`，已进入 readStatus | 过滤 active，复用 recent7 和来源路径，不触发 syncProject 写入 |
| 健康指标 | readStatus.recent7、`workbench.ts` 的 readWorkbench/readRecords | 在 core 中补记录覆盖情况、截止时间、来源和估算标记 |
| 需要处理 | readStatus.inboxNotes、now.pending | 直接复用，数量为 0 时表示确实无待办 |

当前 `readStatus()` 没有训练记录时返回 `workouts: 0`，不能直接用于页面的健康指标。
core 聚合应在无对应记录时返回 `value: null`，由页面显示「暂无记录」；有记录的真实零值仍保留。
日均睡眠与蛋白质沿用 core 的「有记录日期日均」，展示记录天数、统计起止及查询截止时间。
最新体重可以早于 7 天区间，应另标该条记录时间，不把它误称为 7 天内测量。
项目提交数同样需要区分未同步与实际零提交。

历史目前只有 oid、message、time，没有独立 actor 字段，提交 author 统一为「开图」。
第 2 段只能依据已知写入入口的说明做可追溯分类，例如「Drive 收件箱」为云端、DeepSeek 对话为 Agent、明确「你」操作为用户。
无法识别的旧版本保留「来源未记录」，不猜成用户。先做查询结果投影，不改 PRD §6 或记录 schema。

依据：[status.ts](../packages/core/src/status.ts:5)、[history.ts](../packages/core/src/history.ts:167)、
[overview.ts](../packages/core/src/overview.ts:107)、[projects.ts](../packages/core/src/projects.ts:124)、
[workbench.ts](../packages/core/src/workbench.ts:113)、[云端写入说明](../packages/core/src/inbox.ts:106)。

## 5. 精确依赖清单与停止点

安装目标为现有 `@kaitu/dsh-plugin` 包，全部使用精确版本，不改其他包的依赖范围。

| 类别 | 包 | 版本 | 用途 |
| --- | --- | --- | --- |
| peer + dev | `@deepseek-ai/cordis` | `4.0.4` | Host 服务与 Context 类型，避免打入第二份框架 |
| runtime | `@deepseek-ai/dsh-typert-protocol` | `0.2.0-rc.2` | Remote decorator 与 service binding |
| runtime | `zod` | `4.4.3` | 生成的 Host/Client codec |
| dev | `@deepseek-ai/dsh-typert-generator` | `0.2.0-rc.2` | 严格协议生成 |
| dev | `@deepseek-ai/dsh-typert-registry` | `0.2.0-rc.2` | Host 手动注册的公开类型 |
| dev | `@deepseek-ai/dsh-api-remotes` | `0.2.0-rc.2` | Client Remote 类型 |
| dev | `@deepseek-ai/dsh-client-ui-layout` | `0.2.0-rc.2` | main Slot 与 panel id 类型 |
| dev | `@deepseek-ai/dsh-client-ui-sidebar` | `0.2.0-rc.2` | sidebar.panellist 类型 |
| dev | `@deepseek-ai/dsh-client-ui-slots` | `0.2.0-rc.2` | Slot props 与 injection 类型 |
| dev | `@deepseek-ai/dsh-client-ui-renderer` | `0.2.0-rc.2` | ctx.slots 声明合并 |
| dev | `@deepseek-ai/dsh-client-ui-primitives` | `0.2.0-rc.2` | 共享控件，浏览器 external |
| dev | `react` | `18.3.1` | JSX 编译依赖，与外壳一致，浏览器 external |
| dev | `@types/react` | `18.3.31` | React 类型 |
| dev | `clsx` | `2.1.1` | dsh 组件样式组合 |
| dev | `esbuild` | `0.28.2` | Host/client bundle 与 factory 包装 |
| dev | `lightningcss` | `1.33.0` | CSS Modules 编译 |

dsh 包版本来自对应 package.json；Cordis 为 vendored package.json 的 4.0.4。
React、React 类型、clsx、Zod 版本与 dsh 的 pnpm-lock.yaml 一致。
esbuild、lightningcss 已在开图锁文件作为传递依赖存在，但本包尚未直接声明，仍需由 Claude 增加直接 devDependency。
generator 自身依赖 TypeScript 6.0.3 系列，由 pnpm 安装其依赖，不要求把开图全仓 TypeScript 5.9.3 升级。
其余由 pnpm 根据这些精确的直接依赖解析并锁定传递依赖。

依赖清单已另写 `/tmp/kaitu-dsh-deps.txt`。本次到此结束，由 Claude 安装后再开第 2 段。

## 6. 第 2 段的视觉与验收落点

使用 ui-primitives、CSS Modules、dsh 语义 token，按用户指定的冷白、墨黑、中性灰与少量蓝色调整页面局部表现。
需要精确参考色时只在页面作用域处理，不改全局主题。无渐变、少边框，展开区展示记录或来源路径。
视觉参考只取自 [open-claude-ui 设计手册](/Users/yihongguo/Developer/open-claude-ui/docs/README.md:73)
中的表面层次、留白、点击反馈、键盘焦点与减少动态效果，不引入其 Tailwind、Framer Motion 等依赖。
dsh 约定见 [web-styling.zh.md](/Users/yihongguo/Developer/deepseek-harness-rc2/docs/web-styling.zh.md:7)。

第 2 段补一个临时工作区 Remote method 测试，验证无健康记录时指标为 null，不断言文案，不写 UI 测试。
完成后执行 build、typecheck、lint、test，并更新 docs/dsh.md 的「总览页」。
桌面 rc.2 的绝对路径插件加载、侧栏导航、Remote 请求、样式融合与来源展开仍需真机验证。
本次没有运行安装命令，没有触碰 ~/.dsh、~/kaitu 或 Google Drive，也没有提交。
