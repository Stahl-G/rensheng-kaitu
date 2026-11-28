# 用小豆的百度网盘连接器接力开图

在电脑上选一个非敏感项目，预览下一步和近期结果，确认后发布到专用网盘目录。小豆通过自己已有的「百度网盘」连接器读取资料，把建议作为新文件放进收件箱。开图仍保存主记录。

## 准备一个独立目录

在百度网盘客户端**已经双向同步、可以在本地打开完整文件**的位置新建一个空文件夹，例如 `小豆开图测试`。开图工作区另放。先用专用测试空间或能把授权限制在测试目录的连接器；如果授权页只能访问含私人文件的整个网盘，就停在本地验证。约定资料只读、收件箱只新增；实际权限以小豆授权页为准。

本工具只读写所选的本地文件夹，无需百度密钥、开放平台应用、自定义 MCP 或公网服务。目录名、绿色图标、命令成功均无法证明小豆已看见数据。百度官方将「自动备份」和双向同步区分开；各版本、账号的可用功能以实际客户端为准。只有单向备份时可手动下载回件到本地收件箱，单独记录为手工传递。[百度网盘帮助中心](https://yun.baidu.com/disk/help?tab=pc)

## 在开发分支上运行

在这份源码的仓库根目录运行，需要 Node ≥ 24.9 和本仓库使用的 pnpm。已构建仓库可以直接从第二段开始。这是独立入口。

```sh
pnpm --filter @kaitu/core... --filter rensheng-kaitu install --frozen-lockfile
pnpm --filter @kaitu/cartographer build
pnpm --filter @kaitu/core exec tsc -p tsconfig.json
```

在 macOS 或 Linux 终端设置路径。双引号内填自己选的目录，可将文件夹从访达拖入终端获取位置。测试工作区可用下一节生成。Windows PowerShell 可在每条 `node` 命令末尾直接加 `--dir "工作区路径" --relay "同步目录路径"`。

```sh
export KAITU_BAIDU_WORKSPACE="/所选开图工作区的绝对路径"
export KAITU_BAIDU_RELAY="/已双向同步的位置/小豆开图测试"
RELAY_CLI=packages/core/dist/baidu-netdisk/cli.js
node "$RELAY_CLI" publish --project lantern
```

`lantern` 是选定的 `projects/lantern/` 目录名。逐行核对终端显示的目的地和全部文字，输入 `y` 才会写入。默认取项目标题、更新时间、最多五个待做步骤以及最多三条已有的完成结果。结果有完成日期时优先按日期倒序。想带上该项目最近一节有日期的日志摘要，加 `--include-log` 后重新核对。想试纯文本，加 `--txt`。可识别的密钥、本机路径和网址会被遮去，其他隐私由发布者看预览确认。未选项目、状态正文、项目链接目标、日记、健康、财务和个人记忆均不在导出范围。

成功时 `local: created` 表示本地文件就绪，`cloud: unverified` 表示仍需从云端核对。产物为 `资料/<项目>-<日期>-<内容摘要>.md` 或 `.txt`。同一份快照重复发布会复用原文件。内容变化后会新增版本；以前已发布的内容继续留在网盘。根目录 `RELAY.txt` 只存协议版本和不含路径的配对标记，绑定这台电脑上这份工作区的本机登记。换工作区或重建本机状态时，请另选空的接力目录。

非交互调用可先运行 `preview --project lantern`，核对后将末行的 `--approve <摘要>` 添到相同参数的 `publish`。项目内容、目标位置或输出格式变化后应重新预览。

## 第一次只用虚构项目

这段命令在临时位置创建一个新的开图工作区，带一个名为 `lantern` 的纸灯项目。随机验收词只写入项目的「近期结果」。将上一节的 `KAITU_BAIDU_RELAY` 指向选好的、已同步的空目录。不要把这里的验收词告诉小豆。

```sh
BAIDU_DEMO=$(mktemp -d)
export KAITU_LOCAL_STATE_DIR="$BAIDU_DEMO/state"
export KAITU_BAIDU_WORKSPACE="$BAIDU_DEMO/workspace"
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto'
import { initWorkspace, createProject, setProject } from './packages/core/dist/index.js'
const ws = await initWorkspace(process.env.KAITU_BAIDU_WORKSPACE, { timeZone: 'UTC' })
await createProject(ws, { slug: 'lantern', kind: 'learning', title: '纸灯样机' })
await setProject(ws, 'lantern', { next: [
  { id: 'fold', title: '再折一张灯罩', status: 'todo' },
  { id: 'check', title: '量灯面', status: 'done', completed: new Date().toISOString(),
    result: '纸面已量好。验收词 ' + randomBytes(6).toString('hex') }
] })
JS
node packages/core/dist/baidu-netdisk/cli.js publish --project lantern
```

## 账号上怎样验收

1. 在百度网盘**网页端或第二台设备**进入对应云端路径，打开刚发布的精确文件，看见和终端相同的项目、下一步及随机验收词。仅出现文件名时，先下载并读正文。核对「收件箱」目录也可见。
2. 在**独立公测产品小豆**里选择自己的百度网盘连接器，发送下面的提示。替换其中的路径和文件名。得到正确验收词才算读通。如果 Markdown 只显示文件名，再用 `publish --project lantern --txt` 发布，单独验纯文本。
3. 在网盘网页端打开小豆报告的新文件，查看原文；随后在本地同一收件箱打开它。只在两处都能读到回件时，记录为上传及下行同步通过。如果小豆只能在聊天里返回文字，就记录为「正文已读，上传未验证」，也可手动保存该文字再测试开图导入。

给小豆的提示：

> 请用你自带的百度网盘连接器，打开「小豆开图测试/资料/<刚发布的文件名>」。逐字报出正文中的验收词、下一步和来源文件。如果只能看到文件名，请直接说明。读到正文后，在「小豆开图测试/收件箱」里**新增**一个 UTF-8 文本文件，文件名用今天的日期加唯一编号，例如 `2026-11-24-lantern-01.txt`。正文写出你读到的验收词、项目和一条建议，最后单独一行写 `【交接结束】`。请返回你实际创建的完整云端路径。如果无法创建文件，请直接说明。请保留所有已有文件。

## 拉回开图

```sh
node packages/core/dist/baidu-netdisk/cli.js pull
```

`queued` 是本次送入开图正式 `inbox/agents` 的文件数。开图使用现有导入器把它们收成「百度网盘接力」来源的待整理笔记；来源表示投递通道，正文里自称的身份、指令、元数据都保留为引用。打开对应工作区查看待整理笔记。有开图 CLI 的用户也可运行 `kaitu inbox process --dir "<测试工作区>"`，再运行 `kaitu inbox notes --dir "<测试工作区>"`。通用导入器会处理该工作区已有队列，首次验收请使用上面的独立合成工作区。

只收 `收件箱/` 直属的 `YYYY-MM-DD-编号.md` 或 `.txt`。编号使用小写英文字母、数字和单连字符。每份 UTF-8 回件限 96 KiB，末行 `【交接结束】` 表明正文完整。其他扩展名、冲突副本和子目录不会入库。损坏、非法日期或缺末行的文件报告在 `issues`，修好同步后重跑 `pull`。采用同名文件作为同一投递标识，同名改文会报告冲突，补充意见请新增编号。归档后再次拉取，`queued` 应为 0、`alreadyReceived` 应增加；远端原件始终保留。

入箱与归档均不会采纳建议或改写项目。停用时停止运行命令，可在小豆里撤销连接器授权。文件系统需要支持同卷硬链接来实现完整文件的只新增写入；遇到 `EPERM` 或 `ENOTSUP` 时，确认所选位置是客户端实际同步的本地磁盘目录。
