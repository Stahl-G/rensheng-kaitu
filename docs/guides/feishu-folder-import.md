# 飞书 folder → 原文：方案 A 合成原型（FEISHU-1）

本项是用户新增范围，不属于原 K6/K7。仅用 fakeCLI 合成验收，尚未完成真实账号接入。

用户自行安装、认证官方 `larksuite/cli` 1.0.98 后，可手动运行：

```sh
node packages/cli/dist/main.js feishu --help
node packages/cli/dist/main.js feishu import \
  --dir /absolute/path/to/kaitu \
  --folder YOUR_FOLDER_TOKEN \
  --cli /absolute/path/to/lark-cli \
  --timeout-ms 30000
```

仅接受明确指定的工作区、一个 folder token 与 CLI 可执行文件绝对路径。不查找安装位置，不扫描账号或凭据目录。
官方 CLI 使用用户已有的本机配置；开图不安装、注册或登录 CLI，不代管飞书凭据，不把内容上传开图服务器。
folder 只是开图的读取 allowlist，**不是 OAuth 权限硬隔离**；官方 CLI 的账号权限可能覆盖更大范围。

启动后 stderr 立即显示读取状态和调用数，stdout 返回 JSON 回执。Ctrl-C/SIGTERM 取消。
成功和失败回执均带 `requests`（只读 CLI 调用尝试数（包括启动失败））和 `versionChecks`。
`requests = 清单页数 + 逐篇 revision 查询数 + 未保存版本的 fetch 数`；版本检查另计一次。
它不是上游 HTTP 请求数或官方额度消耗：一次 `+fetch` 内部可能请求多次，不能用此数字承诺免费额度。
只读调用串行，启动间隔至少 210 ms（调用边界不超过 5 次/秒）；不控制官方 CLI 内部 HTTP 调度。
默认每次调用超时 30 秒，超时、取消、认证、权限、429、额度 `99991403` 等错误直接停止，无自动重试或 hint 执行。
失败前已经保存的版本保留；用户可修复问题后手动重跑。

仅逐页列出该 folder 的直接子项，`type=docx` 才读取；folder、ordinaryfile、sheet、bitable 等跳过。
没有递归、`--page-all`、定时轮询、远端写入或自动下载外部资源。
先查询真正 revision，再以 `--revision-id` 固定 fetch Markdown，核对返回 ID 与 revision；不以 mtime 推断变更。
每次运行只检查一次 CLI 版本，返回数据在子进程边界按各命令必需字段检查。
固定依据：[官方源码 017b19a](https://github.com/larksuite/cli/tree/017b19a793ad71794a02887ede04757f3d82e10d)，
[fetch](https://github.com/larksuite/cli/blob/017b19a793ad71794a02887ede04757f3d82e10d/skills/lark-doc/references/lark-doc-fetch.md)、
[list](https://github.com/larksuite/cli/blob/017b19a793ad71794a02887ede04757f3d82e10d/skills/lark-drive/references/lark-drive-files-list.md)、
[错误协议](https://github.com/larksuite/cli/blob/017b19a793ad71794a02887ede04757f3d82e10d/errs/ERROR_CONTRACT.md)。
npm 二进制与该源码的一致性未实测。

完整 Markdown（包括空字符串、首尾空白和超过 10 万字的正文）存为既有 `inbox/notes/<日期>/*.md` 原文，`kind: capture`。
保留标题、来源 URL、远端 ID 和 revision。身份仅由远端 ID + revision 决定，标题变化不改身份，同名异 ID 各自保存。
同版本重跑或归档后重跑零新文件；新版本另追加；远端消失不删本地，本地编辑不被覆盖。
写入使用既有工作区路径约束和外部入口检查，完整临时文件写成后以独占硬链接发布，不覆盖已有文件。
本机状态目录下 `feishu/imports.json` 只记成功的身份映射，排除历史与备份；不新增共享 schema 或存储后端。
原文写成功但映射失败会报错，下一次手动运行可从原文或归档恢复映射。
已有映射命中不遍历原文目录；本次导入首次缺映射时枚举一次原文及归档路径，后续文档复用，结束即释放。
导入期间只锁飞书导入自身；强制杀死开图进程可能留下 `feishu/import.lock`，核对没有导入进程后需用户移除此锁。
文件系统不支持硬链接时显式失败，不降级为覆盖写。

所有 CLI 调用共用本次独立临时 cwd，结束时只清理自身目录，隔离 fetch 可能写出的 sidecar。
只保留正文 Markdown，附件、评论、资源引用不保证保真；不执行导入内容。
单次 stdout/stderr 各有 64 MiB 进程缓冲上限，超过时报错，不截断存成成功原文。
个人账号资格、2026 年十月额度、真实认证与云端/移动 UI 均需用户另行实测。
此入口不属于飞书聊天 collector，不代表云端整理员或移动端已验证。
