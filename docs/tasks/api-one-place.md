# 界面接口只写一处

2026-11-11 开工，分支 `claude/vigilant-ptolemy-drika5`（PR #382）。用户已让其他开发线停下，由本任务统一处理；接手的人先读这一页，再看 PR 描述里的进度。

## 要做成什么

给界面加一个功能，只在一个地方写服务端方法，独立 Kaitu.app（本机 HTTP）和 DSH 插件（Typert）两边都能用，参数检查和返回值一致。

现在同一件事要写四到五处：

| 处 | 文件 | 现状 |
|---|---|---|
| 插件服务端 | `packages/dsh-plugin/src/overview-service.ts`、`finance-service.ts` | 约 130 个 `@Remote` 方法 |
| 独立版服务端 | `packages/cli/src/ui/product.ts` | 约 140 个分支，其中 114 个和插件端同名，行为有细小出入 |
| 插件客户端入口 | `packages/dsh-plugin/src/client/index.tsx` | 每个方法一段「调用、拆结果、抛错」 |
| 独立版客户端入口 | `packages/dsh-plugin/src/standalone/main.tsx` | 每个方法一行 `call("名字", …)` |
| 哪些方法算写入 | `product.ts` 的 `productMutations` 字符串集合 | 手工维护 |

做完以后的样子：

1. **服务端只有一份实现**：`KaituOverviewService` 和 `KaituFinanceService`。`@Remote` 装饰器要留着，DSH 靠它静态生成类型协议（`lib/typert.host.js`）。
2. **独立版 HTTP 直接调同一个服务对象**。参数用同一份生成出来的协议检查，不再手写 `text(0)` 这类检查。写入排队、通知界面由服务的写入队列统一做，不再靠 `productMutations` 名单。
3. **两边确实不同的事，写成服务的宿主选项，不写成第二份实现**：首页缓存、文件索引、系统日历执行器、版本记录由谁调度。
4. **只在独立版存在的方法留在 `product.ts`**，并且一眼看得出为什么：
   - 问问（`ask*`）：插件里由 DSH 原生会话承担。
   - 要调模型的整理（`onboardingMatterOrganize`、`directionGeneration`、`directionMap*`、`lifeAtlas*`、`projectGoalSuggest`、`resumeExtract`、`resumeConnection`、`suggestNewsKeywords`）：插件里交给宿主对话。
   - 要先停监听和手机服务的操作（`restoreVersion`、`moveStorage`、`workspaceBackup`）：由 `server.ts` 编排。
5. **客户端只有一份「页面属性 ← 方法」的对应表**，两个入口各自只提供怎么发请求，以及各自宿主独有的几项（问问面板、文件选择、插件管理）。

不追求：把页面组件的上百个属性改成一个 `api` 对象。那是另一件事，收益小、改动面大。

## 怎么证明做成了

- 两端方法清单做差集：除上面第 4 条列出的名字外为空。清单从代码里读出来，不手写。
- 独立版真机走查（合成工作区，Chromium）：首次使用采纳一步、记一条原文、提待办并采纳、完成并记结果、日程确认、资料搜索、导入预览与确认、个人档案改头像、设置读写。每步看界面结果，并回读工作区文件。
- 错误参数：对独立版接口发类型不对的参数，返回 400 和 `BAD_ARGS`，资料不变。
- 日常操作耗时不退步：在五年量的合成工作区上，写入 0.1 秒内返回，页面读取和改前同一量级。数字写进 PR 描述。
- `pnpm build`、`typecheck`、`lint`、`test` 与改前基线一致（基线有 4 条在 Linux root 容器里失败，见 PR #382）。
- **本任务证明不了的**：真实 DSH 宿主和打包后的 Mac / Windows App。插件端服务的方法签名和行为不该变，但要用户或有真机的人装包确认。

## 能用的材料和工具

- 生成的协议：`packages/dsh-plugin/lib/typert.host.js`（构建产物），`TYPERT.invocations["kaitu/<方法>"].parameters[i].codec.create()` 是该参数的 zod 检查。
- 合成工作区与测量脚本放仓库外（AGENTS 第 9 条）。做法：`kaitu init --sample` 后把 2026-10 的数据文件复制到之前 60 个月，另加 800 条原文。
- `packages/cli/test/ui.test.ts` 走的是独立版 HTTP；`packages/dsh-plugin/test/*` 直接调服务类。

## 不能碰的

- 数据规范（PRD §6）、`schemas/`、记录 ID、工作区文件格式。
- `@Remote` 方法的名字、参数和返回类型：这是已发布插件和宿主之间的协议，其他插件也可能在用。只加可选的宿主选项。
- 独立版 HTTP 的路径（`/api/product/<方法>`、`/api/events` 等）。旧的 `/api/state`、`/api/proposal` 一类路由有测试在用，本任务不删。
- 不新增依赖、持久化格式、设置开关。

## 顺序

1. 服务加宿主选项；`product.ts` 改为检查参数后转给服务；`server.ts` 建服务对象并交出写入队列。
2. 客户端两个入口共用一份对应表。
3. 走查、实测、更新 PR 描述和 HANDOFF。

每一步单独提交，都要过检查。做不到的地方写进 PR 描述，不降级交付。
