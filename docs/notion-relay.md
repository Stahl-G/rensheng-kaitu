# 用小豆的 Notion 连接器接力开图

开图保存主记录。本机适配器把选中的项目做成 Notion 页面，独立公测产品「小豆」从自己的 Notion 连接器读页面，在另一个库新建接力结果。开图收件箱接收结果，用户核对后决定如何使用。此开发分支从命令行启用，默认关闭。

## 一次性准备

1. 在空白测试空间新建两个独立的整页数据库「开图资料库」「开图收件箱」，保留默认标题列即可。每个库打开 `••• → 管理数据源 → 复制数据源 ID`。选择原始数据源，数据库网址中的 ID 和视图 ID 都不适用。
2. 在 Notion 开发者门户创建两个内部连接。给「开图发布」勾选读取和插入内容，仅在资料库的 `••• → 添加连接` 添加它。给「开图收取」只勾选读取内容，仅在收件箱添加它。关闭更新、评论、用户信息等其他能力。保持两个库私有。父页面授权会继承给子页面。[创建页面及查找 ID](https://developers.notion.com/guides/data-apis/create-pages-in-a-data-source) · [官方权限说明](https://developers.notion.com/reference/capabilities)
3. 在小豆的连接器列表中找到 Notion，选择同一测试空间。界面支持时，仅允许读取资料库、读取及新增收件箱页面。若只能授权整个空间，只在没有其他资料的专用测试空间验证；若没有该入口或没有新增能力，分别记为「连接器不可用」或「只读」。本机的内部连接密钥只留在终端，小豆使用它自己的授权。

在此分支根目录用 Node 24.9+ 和仓库指定的 pnpm，运行以下准备命令。下例使用 macOS 的 zsh，输入密钥时终端不回显。

```zsh
pnpm install --frozen-lockfile
pnpm build
export KAITU_NOTION_LIBRARY='替换为资料库数据源ID'
export KAITU_NOTION_INBOX='替换为收件箱数据源ID'
read -rs 'KAITU_NOTION_LIBRARY_TOKEN?开图发布密钥：'
echo
read -rs 'KAITU_NOTION_INBOX_TOKEN?开图收取密钥：'
echo
export KAITU_NOTION_LIBRARY_TOKEN KAITU_NOTION_INBOX_TOKEN
relay() { node packages/cli/dist/notion-relay.js "$@"; }
kaitu() { node packages/cli/dist/main.js "$@"; }
```

## 发布第一条合成快照

```zsh
DEMO=$(mktemp -d)
kaitu init "$DEMO"
mkdir -p "$DEMO/projects/exhibit"
cat > "$DEMO/projects/exhibit/STATUS.md" <<'END'
---
title: 合成纸艺展
stage: active
updated: "2026-11-24T01:00:00Z"
next:
  - {title: 核对蓝色展签, status: todo}
  - {title: 检查打样, status: done, result: 七号样签通过, completed: "2026-11-23T09:00:00Z"}
---
此段只留在本机。
END
relay preview "$DEMO" exhibit
```

预览会列出目标 ID、远端标题、完整正文和 `code`。核对该项目及每行文字都可以外发后，将下面的占位文字换成这次的 `code`。本机只读取指定项目的 STATUS 字段。取第一条待做或建议的下一步，以及按完成时间排序的最近一条有文字的结果；缺项会标出。更新日期缺失时使用该状态文件的修改时间。

```zsh
relay publish "$DEMO" exhibit '粘贴本次预览的code'
```

发布后会读回正文逐段核对，返回 `verified: true` 和页面 ID。同一预览重跑会核对已有页。修改源数据或目标需要重新预览，新的快照新建一页。用同一台电脑及工作区发布；多台机器同时首发同一快照没有跨机唯一约束。遇到超时，重跑同一命令先查同名页面。本机保留每次创建的标记；若仍提示待核对，先在 Notion 按完整标题查找。只在确认未建页、此前的请求已结束时，移走报错中该快照的标记后重试。限流会按 `Retry-After` 等待，最多重试三次；等待超过一分钟时显示建议稍后重试。[创建页面](https://developers.notion.com/reference/post-page) · [查询数据源](https://developers.notion.com/reference/query-a-data-source) · [请求限制](https://developers.notion.com/reference/request-limits)

## 在小豆账号上验收

发布前确认两个库为空。如要验证读取范围，可在同一测试空间建一个未授权的独立对照库，只在里面写一个随机合成口令。发布后打开 Notion 的资料库页面，核对页面正文、来源和日期。再另开小豆对话，发送以下提示，保留正文校验词作为盲测答案。

> 请用你自带的 Notion 连接器打开「开图资料库」中最新的「合成纸艺展」。逐字读出正文里的最近结果，同时报告下一步、阶段、来源和更新日期，并给我原页链接。然后在「开图收件箱」新建一条「纸艺展接力」，用普通文字段落写下原页链接、最近结果，以及一条待核对的下一步。返回新建页链接。读不到正文或无法新建时，说清停在哪一步。

人工打开返回的两个链接：只有复述了正文里的「七号样签通过」并且收件箱出现带正文的新页，才分别记为读、写通过。另请小豆读取未授权测试库里的口令，不在对话中透露答案；如果能读到，断开并核对授权范围。Notion 官方 API 的读写权限与小豆连接器向该账号开放的能力要分别验收。小豆只读时，可手动将其结果粘贴为收件箱新页、继续验证本机收取，把小豆新增记为未通过。

```zsh
relay pull "$DEMO"
kaitu --dir "$DEMO" inbox process
kaitu --dir "$DEMO" inbox notes
relay pull "$DEMO"
```

第一遍应显示 `queued: 1`，待整理笔记可见 Notion 来源、原页 ID、创建时间和正文。第二遍应显示 `queued: 0, existing: 1`。开图正常运行时也会处理 `inbox/agents`。同一结果页归档后仍去重；更正时在收件箱另建一页并注明原页。空白页和不支持的正文结构列在 `deferred`，下一次可再拉取。收件箱支持顶层段落、标题、引用和普通列表中的文字；用普通段落交回，避免附件、提及、嵌套页、同步块。适配器仅访问显式配置的两个数据源，远端操作仅查询、读取和新建。[分页读取正文块](https://developers.notion.com/reference/get-block-children)

退出本次配置可关闭终端，或运行 `unset KAITU_NOTION_LIBRARY_TOKEN KAITU_NOTION_INBOX_TOKEN`。
