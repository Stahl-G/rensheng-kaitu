# 开图发布前安全与隐私审查

审查日期：2026-10-16。代码基线：`19d5c12c07ce7227669d5521096e7b0e114fb827`（main 当前 checkout）。

结论：已确认 3 项与客户资料保密直接相关的权限缺口，建议作为相关功能的发布阻断项处理；另有 2 项完整性/可用性问题和开发依赖漏洞需要整改。本次是源码、依赖与合成数据验证，没有修改产品代码，也没有使用真实客户资料。

## 项目用途与数据流

开图是本地优先的个人资料与行动管理工具。健康、财务、项目、记忆、对话和行动记录以 Markdown、JSON、JSONL 保存在用户工作区；历史版本由 isomorphic-git 保存，搜索使用 SQLite FTS5。用户通过 CLI、本地 Web 工作台、独立桌面应用或 DeepSeek Harness 插件操作同一套 core 数据层。

可选连接包括 MCP 远端 AI、Google Drive 云端接力、Apple Health 导入，以及微信、Telegram、飞书、QQ 手机通道。关键隐私边界是：远端工具只能看到允许共享的资料；`local_only` 项目留在本机；模型不能读取程序密钥或改写安全配置；工作区内的数据和模块定义不能使程序访问未授权的本机路径。

覆盖范围：core 数据与文件处理、CLI HTTP/MCP、桌面 SDK 文件权限、DSH 工具、前端内容渲染、手机通道及 Apps Script 入口、锁文件依赖、当前 tracked 文件及可达 Git 历史中的常见密钥格式。

## 发布前优先修复：客户资料保密

### P1 / 高：自定义模块读取绕过工作区路径限制

位置：[records.ts:193](/workspace/rensheng-kaitu/packages/core/src/records.ts:193)、[modules.ts:33](/workspace/rensheng-kaitu/packages/core/src/modules.ts:33)、[modules.ts:75](/workspace/rensheng-kaitu/packages/core/src/modules.ts:75)。

`recordLines()` 将模块声明的记录目录直接与工作区路径拼接后读取，没有经过 `Workspace.resolve()` 的边界及符号链接检查。模块加载时也没有先按模块 schema 拒绝非法定义。

影响：能够修改共享工作区模块定义的云端组件，可以使本机程序读取工作区之外的月度记录文件。MCP remote 按类型名过滤私有项目记录，无法识别被自定义类型重新映射的数据。

验证：在合成 Drive 工作区和独立本机状态目录中，常规 `Workspace.resolve()` 拒绝越界路径，但真实 MCP remote `record_list` 返回了本机私有项目的合成内容。未读取任何真实文件。

前提：需要修改工作区模块定义的权限，以及一个可返回记录结果的接口（本次验证为已授权 MCP remote）。这不是匿名互联网请求即可读取任意文件的结论；已确认的读取对象是符合记录文件命名及解析规则的数据。

整改：模块加载时验证定义；所有记录目录及具体文件读取统一通过受限路径解析，并检查真实路径。公开读取权限不能仅依赖类型名，应结合实际模块、存储位置和数据所属项目判断。

验收：越界及符号链接记录路径都被拒绝；合法自定义模块仍可工作；remote 无法借别名读取本机私有记录或财务数据。

### P1 / 高：桌面内置 AI 可读取程序密钥并修改状态目录配置

位置：[sdk-filesystem.mjs:14](/workspace/rensheng-kaitu/packages/desktop/sdk-filesystem.mjs:14)、[sdk-runtime.mjs:75](/workspace/rensheng-kaitu/packages/desktop/sdk-runtime.mjs:75)、[workspace.ts:29](/workspace/rensheng-kaitu/packages/core/src/workspace.ts:29)。

桌面原生文件服务只检查目标位于工作区内，没有排除 `.kaitu`。专用业务工具原本对该目录的限制因此未覆盖原生文件读写入口。`state_dir` 又从可写的工作区配置中动态读取，只检查是否为绝对路径。

影响：本地模式下，文件工具可将 `.kaitu/secrets.json` 的内容读入模型上下文；其中可能包含 MCP、GitHub 或手机通道凭据。模型还可修改状态目录配置，使后续内部操作在新目录写入程序状态。

验证：Linux 下使用官方 DSH 0.2.0-rc.2 的真实 LocalFileSystem、仓库权限封装及实际注册工具验证。工作区外的直接读写被拒绝，但合成密钥文件可读取；修改状态配置后，snapshot 在合成工作区外创建了历史目录。

边界：未启动真实模型或 macOS App，未验证恶意内容诱导模型的成功率；没有证实匿名远程代码执行。已确认的是模型文件能力实际拥有超过预期的权限。

整改：原生读取、搜索、编辑与专用工具共享同一策略，禁止模型访问密钥、历史库和安全配置。可信状态目录应由主进程控制，不能由模型可写文件随时重定向；Drive 模式需要使用独立、受信任的本机映射。

验收：通过所有文件入口读取密钥或修改内部配置均被拒绝；模型无法改变状态根目录；正常笔记读写、搜索和版本保存仍通过。

### P1 / 中：仅本机项目的关联待办会同步或返回给远端

位置：[mcp/server.ts:132](/workspace/rensheng-kaitu/packages/cli/src/mcp/server.ts:132)、[mcp/server.ts:158](/workspace/rensheng-kaitu/packages/cli/src/mcp/server.ts:158)、[workbench.ts:125](/workspace/rensheng-kaitu/packages/core/src/workbench.ts:125)、[overview.ts:195](/workspace/rensheng-kaitu/packages/core/src/overview.ts:195)、[tasks.ts:73](/workspace/rensheng-kaitu/packages/core/src/tasks.ts:73)。

公开记录过滤只处理部分项目记录类型，未处理 `task.project`。任务统一保存在工作区 `me/data/tasks/`，Drive 迁移也没有隔离私有项目关联任务。

影响：项目设为 `local_only` 后，关联待办的标题、备注和项目标识仍可发给云端组件，违背“仅本机”的隐私预期。

验证：真实 MCP HTTP 中，私有项目列表为空、项目文档直读被拒绝，但 `task_list`、`record_list(task)`、`status` 和 `read_file(OVERVIEW.md)` 返回私有任务标记。另执行合成 Drive 迁移，确认任务标题和完整备注仍保存在同步目录的 `me/data/tasks/` 文件中。

前提：用户有私有项目关联任务，并使用 MCP remote 或 Drive 共享；不要求云端组件有本机文件权限。

整改：对所有项目关联记录统一继承项目可见性，并同步处理任务的本机存储、迁移、版本、公开聚合和接口过滤。修复已有工作区时，还需识别已进入共享目录或公开摘要的私有任务；仅增加接口过滤不足以解决已同步副本。

验收：私有项目任务不出现在 MCP、公开状态、OVERVIEW 或 Drive 实际文件中；切换项目可见性时历史修订也按约定迁移。

## 其他已确认问题

### P2 / 中：DSH 文件写入的保护判断使用未规范化路径

位置：[workspace-files.ts:25](/workspace/rensheng-kaitu/packages/dsh-plugin/src/workspace-files.ts:25)、[workspace-files.ts:35](/workspace/rensheng-kaitu/packages/dsh-plugin/src/workspace-files.ts:35)、[workspace-files.ts:43](/workspace/rensheng-kaitu/packages/dsh-plugin/src/workspace-files.ts:43)。

保护名单、规则/目标的确认判断、重复检查和验证结果匹配使用调用者原始路径；实际文件写入使用规范化路径。已通过注册工具验证，同一合成规则文件的等价路径形式能绕过 `confirmed:false` 拒绝逻辑。

这是用户决定和数据完整性的防护缺口，未证明直接信息外泄。入口应先规范化路径，再让所有检查与写入使用同一结果；确认标记也应有明确的可信来源。

### P2 / 中：健康导入缺少时间范围及工作量限制

位置：[apple-health.ts:217](/workspace/rensheng-kaitu/packages/core/src/importers/apple-health.ts:217)、[apple-health.ts:532](/workspace/rensheng-kaitu/packages/core/src/importers/apple-health.ts:532)、[inbox.ts:269](/workspace/rensheng-kaitu/packages/core/src/inbox.ts:269)。

活动样本按跨越的每一天同步展开，没有限制单条记录跨度或总候选数。异常但可解析的时间范围可让很小的健康文件造成大量计算；健康收件箱会自动调用该解析路径。

受限验证：正常的合成小样本约 15 ms 完成；相同体积、异常时间范围的样本在独立子进程中超过 2 秒限额后停止。没有进行内存耗尽或生产服务压力测试。这是可用性风险，没有证据表明该问题泄漏资料。

整改：解析前限制合理时间跨度、样本数量和总输出记录数；对 ZIP 另设累计解压字节限制；耗时导入放到可终止的工作线程或子进程。同步循环不能依赖同一事件循环的超时来中断。

## 依赖与已验证防护

`pnpm audit --prod --json` 对 197 个生产依赖未返回已知漏洞公告。这不等于不存在未知漏洞。

完整 audit 返回 4 条命中，对应 3 个独立公告，均属于开发测试依赖：

| 依赖 | 公告 | 当前场景与建议 |
|---|---|---|
| Vitest / @vitest/mocker 3.2.7 | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | 开发服务器 mock 路径读取问题；当前配置是 `vitest run`，未启用公告中的公共 mocker 开发服务器入口。升级至包含修复的受支持版本，公告标明修复起点为 4.1.11。 |
| tinypool 1.1.1 | [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | 扫描标为 Critical，但需要上游原型污染等前提；本次未发现项目内可触达的完整利用链。随测试工具升级使锁文件采用包含修复的兼容版本，两个公告全部修复需 tinypool ≥2.1.2。不要未经兼容验证强制覆盖大版本。 |

这些命中不能直接表述成生产应用存在远程代码执行，但发布流水线依赖也应更新并回归。

已有防护验证：

- UI 错误 Host、恶意或缺失 Origin、缺少 X-Kaitu 的写请求均返回 403；合法写请求返回 200。
- MCP 无 token 返回 401；Bearer 使用恒定时间比较；UI/MCP 默认只监听回环地址。
- 静态资源编码目录穿越请求返回 404。
- Markdown 禁止原始 HTML；常见脚本链接及 HTML 载荷未成为可执行标记。新闻链接有协议白名单。
- Electron 主窗口关闭 Node integration，启用 context isolation 与 sandbox。
- 四个手机通道检查私聊及配对发送者，消息经 stdin 传入 Agent；未发现直接拼接 shell 命令。
- 对 396 个 tracked 文件以及 1055 个历史文本 blob 的常见密钥格式扫描未命中；这只是格式扫描结论，未检查平台实际凭据或图片中的秘密。

此前环境验收的构建、类型检查、lint 和 131 项测试通过；这些正常功能测试未覆盖上述权限缺口，不能替代安全回归。

## 发布整改顺序

1. 先封闭记录读取路径和模型访问程序状态的边界，补充越界拒绝的回归验证。
2. 完成 `local_only` 关联数据的存储及输出隔离，并处理已有共享副本。
3. 修复规范化路径检查、导入资源限制，升级开发依赖并验证兼容性。
4. 在真实 macOS 打包产物上复查模型文件权限；用隔离测试账号复查 Drive、手机通道及 Apps Script 部署权限。当前审查没有完成这些真实外部部署验收。

完成前 3 个隐私阻断项并通过回归后，再发布包含内置 AI、MCP remote 或 Drive 接力的版本。
