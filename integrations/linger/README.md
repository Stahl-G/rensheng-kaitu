# Linger → 人生开图

可选本机工具：从 Linger 下载或自动取得一份 Markdown，先预览，再投递给开图收件箱。开图本身不安装 Linger，不改变问问、DSH、桌面安装包或资料格式。

## 最短路径：已经有附件

从 Linger Room 下载真实 Markdown 文件。macOS 或其他 POSIX 环境安装了 Python 3.9+ 即可；不需要账号、额外包或联网。以下命令从开图源代码仓库根目录运行。

```sh
python3 integrations/linger/bridge.py preview '/附件.md'
python3 integrations/linger/bridge.py import '/附件.md' \
  --kaitu-root '/已有的开图资料目录' --reviewed-sha256 '上一条命令打印的完整摘要'
```

只有第二条命令写文件，且只在已经存在的 `inbox/agents/` 新增一份字节不变的 `.note.md`，不覆盖同名笔记、不扫描或修改正本。开图按自己的流程收录；脚本不代替开图采纳内容。目录内还有同内容文件时拒绝重复写入；开图移走后脚本不保留持久去重记录。本地文件系统须支持硬链接（如 APFS）。

## 自动让 Room 生成附件

使用已运行的 **Linger desktop-v0.1.6**，例如按[官方源码自托管说明](https://github.com/simplexai-labs/linger/blob/77abdcb37f779f9c9d2de89fa245efa88d3f6584/docs/self-hosting.md)启动。无需安装 Linger 才能使用开图或离线导入。不要为安装而关闭 macOS 安全保护。

1. 在 Linger **Settings → Models** 配置你自己的服务商和 Key。桥接不读取或提交 GPT Key。使用专用 Linger 账号，不能有其他私人资料、连接应用或主机目录授权。**私有 Room 不隔离 Agent 的账号权限；不要把开图资料目录授权给 Linger。**
2. 打开只有你和一个在线 Agent 的专用 Room；复制完整聊天地址，把 `localhost` 换成 `127.0.0.1`，保留实际端口。从开图以外选一个尚不存在的 Markdown 路径：

   ```sh
   python3 integrations/linger/bridge.py run --file '/你选的一份源文件.md' \
     --room 'http://127.0.0.1:3000/t/实际Space/rooms/实际Room/chat' \
     --provider OpenAI --isolated-account --output '/已有目录/preview.md'
   ```

3. 输入本机 Linger 登录邮箱、密码，只登录一次，不保存会话。终端显示所选单个文件、Room、Agent 和服务商。输入 `SEND` 才上传；若配置的是云模型，Linger 可能将所选资料发给该提供商并产生费用。提供商名称应与 Linger 实际设置一致。没有可用密码、Room 超时或出现权限卡时，在 Linger 界面检查和下载附件，走上面离线路径。停止终端等待不取消 Agent；不要盲目重发请求。
4. 查看生成的预览原文。用上面的 `import` 命令指定 `preview.md` 和它的 SHA-256，明确投递。

自动适配只接受一个 UTF-8 Markdown/TXT 源文件（最大 1 MiB），只连接明确的本机 Linger IP，禁用代理和跳转，不扫目录。它用普通会话 API 上传和回读实际版本，再接受该 Agent 的匹配附件；网络、运行时或模型失败不会写入开图。

接口依据为 [Linger v0.1.6 固定源码](https://github.com/simplexai-labs/linger/tree/77abdcb37f779f9c9d2de89fa245efa88d3f6584) 的 [TeamHub 会话和 Room 路由](https://github.com/simplexai-labs/linger/blob/77abdcb37f779f9c9d2de89fa245efa88d3f6584/apps/teamhub/internal/app/routes_public.go)、[文件投递说明](https://github.com/simplexai-labs/linger/blob/77abdcb37f779f9c9d2de89fa245efa88d3f6584/.agents/skills/verify-linger/features/documents.md#agent-file-delivery)。适配器使用其接口，没有复制 Linger 源码或内置其运行时。自动链路尚未以真实 GPT 账户端到端验证。

## DSH 插件

在本机图形桌面上从独立环境运行 `dsh plugin --profile web add ./integrations/linger`，
或在插件页选择打包后的 `kaitu-linger-inbox`。本候选支持 DSH 0.2.3-alpha.2、
macOS/Linux、Python 3.9+ 和 Tk。从 DSH 输入 `/linger-inbox`，在运行宿主的电脑上选择
允许读取的 Markdown，查看全文、选择目标工作区，再确认投递。关闭窗口可以取消。
命令只返回结果状态。Room 自动收件仍使用上面的本机终端流程。
