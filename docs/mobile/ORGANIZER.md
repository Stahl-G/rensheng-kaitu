# 开图整理员

规则版本：1（云端 Agent 写进 `phone/today.json` 的 `generator.spec`）。
你是用户指定的整理员：白天在电脑不在时更新手机，夜里做每日整理。日期和时间按 `me/rules.md` 的 timezone。

## 什么时候运行

- 白天：06:30、12:30、18:30、22:30 各一次，只做「白天：更新手机」。用户说「更新开图」时也做一次。
- 夜里：凌晨 3 点一次，做「夜里：每日整理」。
- 电脑上自带的「开图每日整理」定时任务（Kaitu.app 或 DSH）只做夜里第 1–7 步；电脑开着时会自己更新手机。
- 两个 Agent 都当整理员时，运行时间至少错开 30 分钟，互为备份。

## 白天：更新手机

电脑上的开图开着时，它自己会处理手机交来的文件、重新生成手机要读的内容，这一节只在电脑不在时才有活。

### 0. 先看有没有活

满足任意一条才继续，否则直接结束，不留交接：

1. `inbox/agents/` 里有手机文件（文件名 `ios-<8 位十六进制>-<26 位 ULID>.note.md` 或 `.actions.jsonl`），进入资料位置已超过 15 分钟。GitHub 看添加它的那次提交的时间，Drive 看文件的创建时间。
2. `phone/today.json` 的 `today` 不是今天，并且现在已过 00:15。
3. `NOW.md` 或任何 `STATUS.md` 在 `phone/today.json` 的 `generated_at` 之后被改过，已过去 10 分钟，并且不是电脑改的。GitHub 上电脑的提交信息是「开图工作区同步」。

电脑开着时，一两分钟内就会收走手机文件、重算快照，这三条都不会成立。

### 1. 处理手机文件

只处理第 0 步第 1 条里的文件，按文件名排序，一个一个来。每个文件按「执行 → 更新回执（第 2 步）→ 归档 → 删除原件」的顺序做完，再做下一个。

**`.actions.jsonl`：手机上的操作。** 逐行处理：

1. 用 `schemas/phone-action.schema.json` 校验。不合格：回执 `{ref: 文件名, kind: "file", status: "rejected", message: "手机操作格式不合法"}`，接着处理下一行。
2. `phone/receipts.json` 里已有 kind 为 `action`、ref 为这行 `client_id` 的回执：原来是 applied 的回 duplicate；原来是 conflict 或 rejected 的，照原样再回一次。不再执行。
3. 按 op 执行。前提不满足时回 conflict，message 写括号里的原因，不硬改：
   - `complete_next`（file、id）：file 必须是某个模块或项目的 `STATUS.md`（「找不到模块状态」）。frontmatter 的 next 里 id 相同、status 为 todo 的那条改成 done（「这一步已处理或不存在，请刷新」），updated 改成现在，带时区偏移，例如 `2026-10-19T07:42:00+08:00`。
   - `decide_proposal`（id、decision）：`NOW.md` frontmatter 的 blocks 里 id 相同、kind 为 proposal、status 为 pending 的那条（「日程建议已处理或不存在」），status 改成 decision；decision 为 confirmed 时再加 `calendar: phone`。日历由手机自己写，你不碰日历。
   - `replace_memory`（file、candidate、expected）：这是用户在手机上确认的记忆决定。file 只能是 memory/ 下不含路径的记忆文件名；expected 必填 type、name、text、source、sensitive（缺 source 读作 null，缺 sensitive 读作 false）；当前旧条五项必须与 expected 逐项相等且未归档，否则 conflict。candidate 为 null 时给旧记忆写 ended（操作 at 在用户时区的日期）、updated；有候选时先校验 type/name/text/source/sensitive，新建独立记忆文件，旧文件保留并写 ended、updated、replaced_by（新文件名）。更改标题/类型也不重命名旧文件。刷新 MEMORY.md，只列没有 ended 的记忆。同一 client_id 重投不能再新建记忆。AI 自己提出的替换必须以 .memory.json 候选的 replaces 字段交给用户，不能直接归档。
   - `complete_task` / `cancel_task`（id）：在 `me/data/tasks/*.jsonl` 里找这个 id 的最新一行（rev 最大）。它的 status 必须是 open（「待办已处理或不存在」）。把这一行完整复制，status 改成 done 或 cancelled，rev 加 1，by 写 user，追加到同一个文件末尾。旧行不改、不删。
   - 其他 op：回 rejected，「当前版本尚不支持这个操作」。
4. 每行一条回执：`{ref: client_id, kind: "action", status, message, at: 现在}`，只有 conflict 和 rejected 写 message。

只改上面说的字段。同一个文件里的其他字段、正文和格式保持原样。

**`.note.md`：随手记下的原文。** 原样移到 `inbox/notes/<date>/`，date 取它 frontmatter 里的 date；不是有效日期就用今天。`inbox/notes/` 里任何位置已有同名文件时，只删除收件箱里这份。
回执 `{ref: 文件名, kind: "file", status: "applied", at: 现在}`。原文夜里再按第 4 步整理，这里不改内容。

**不处理的：** `.records.jsonl`、`inbox/health/`、其他 Agent 交的文件，留给电脑（或第 5 步的命令）。

**归档：** `.actions.jsonl` 照抄到 `inbox/processed/<今天>/` 下的同名文件，再从 `inbox/agents/` 删除原件。`.note.md` 已经移走，不用归档。

### 2. 写回执 `phone/receipts.json`

在原有 items 上合并：同一个 kind 加 ref 只留最新一条；删掉 at 早于 14 天前的。
写成 `{format: "kaitu.phone.receipts", version: 1, generated_at: 现在, items}`。内容没变就不写。

### 3. 重算 `phone/today.json`

按 `schemas/phone-today.schema.json` 写：

- `today`：今天（YYYY-MM-DD）。`timezone`：`me/rules.md` 的 timezone。
- `next`：今天最重要的三件事，第一项就是手机上的「最重要的一件事」。
  1. 读所有 STATUS.md：有 `module.json` 的模块目录（含子目录）里的 STATUS.md；`projects/` 只看 `projects/STATUS.md` 和 `projects/<项目>/STATUS.md`。项目的 stage 是 paused 或 done 的，整份跳过。
  2. 取 next 里 status 为 todo 或 proposed 的条目。没有 id 的跳过，并写进交接。
  3. 排序：已过期（due 早于今天）的在前；再按 priority：high、normal（没写算 normal）、low；再按 due 从早到晚，没有 due 的在后；最后 todo 在 proposed 前。
  4. 取前三项，每项 `{id, title, file, module, section, proposed}`：
     - file：这个 STATUS.md 的相对路径。
     - module：所在模块 `module.json` 的 name；项目写项目 STATUS.md 的 title。
     - section：file 以 `health/` 开头为 health，`projects/` 为 projects，`feed/` 为 feed，`me/` 为 me，其余为 today。
     - proposed：status 是否为 proposed。
- `proposals`、`blocks`：`NOW.md` 的 date 是今天才取，否则都是空数组。proposals 是 kind 为 proposal、status 为 pending 的块；blocks 是 status 为 confirmed 的块。每块写 `{id, title, kind, status, start, end}`，有 module、calendar 才写。没有 id 的块跳过，并写进交接。
- `goals`：照抄上一份。这次完成或取消的待办如果是某个目标的 `next.id`，把那个目标的 next 改成 null。
- `question`：null。
- `sync`：
  - received：处理完后 `inbox/agents/` 里剩下的文件数；上一份的 organizer 为 true 时，再加上 `inbox/notes/` 下（不含 `done/`）的原文数。
  - needs_review、organizer：照抄上一份，这两项只在电脑上变化。
  - updated_at：这次改了资料就写现在，否则照抄。
- `format: "kaitu.phone.today"`、`version: 1`、`generated_at: 现在`、`generator: {kind: "agent", name: "<你的名字>", spec: 1}`。

写之前：

- 用 schema 校验。不合格就不写，在交接里写清楚哪里不对。
- 除了 generated_at 和 generator，和原来完全一样就不写。
- 不写财务明细、标为敏感的记忆、Key、本机绝对路径；file 只写资料位置内的相对路径。

`phone/week.json`、`phone/map.json`、`phone/library.json` 不动，手机会显示它们是电脑哪天生成的。

### 4. 留交接

这次写过任何文件，结束前按 `AGENT-README.md` 新建 `handoffs/<YYYYMMDDTHHMM>-<你的名字>.md`：

- 做了什么：处理了哪些手机文件、各自的结果，是否重算了 today.json。
- 当前下一步：写「已直接改在 STATUS.md」，再列出今天的前三项。
- 未决 / 需要用户：conflict、rejected、跳过的条目和原因。

### 5. 能运行命令时

v0.7 计划提供，发布前跳过本步。在资料位置根目录运行 `kaitu phone run --as "<你的名字>"`：用电脑上同一份代码完成第 1–3 步，还会处理 `.records.jsonl` 和健康文件，并生成 week.json、map.json。之后只做第 4 步。

## 夜里：每日整理

1. `handoffs/daily/<今天>.md` 已存在：今晚已经有人整理过，跳到第 8 步。
2. 读最新的每日整理（没有就读 `OVERVIEW.md`），再读它之后的全部交接记录（`handoffs/` 根目录）和 `inbox/agents/` 文件。没有交接记录时跳过第 3、6 步。
3. 把交接合并进各模块 STATUS.md 的 next，不整份照抄交接：
   - 改之前先重读，以 STATUS.md 现在的 next 为起点。
   - 只应用交接明确写出的变化（完成、新增、改期、取消）；交接没提到的条目原样保留。白天交接里「已直接改在 STATUS.md」的不用再改。
   - STATUS.md 的 updated 晚于最新一份交接的 at：用户在交接之后改过，这个文件的 next 不动，把交接和现状的差异写进「未决事项」。
   - 只改 next 和 updated 两个字段，不动其他字段和正文；next 有改动才更新 updated。
4. 整理用户随手记下的原文。要用开图工具：Kaitu.app 或 DSH 里的 AI 用 kaitu_inbox 和 kaitu_onboarding，命令行用 kaitu inbox notes / done 和 kaitu onboarding matter-read / matter-draft。
   - 读待整理笔记，只处理 kind 为 capture 的原文，逐条用 matter-read 读取；已经带草稿的不重写，直接归档。
   - 写的是想改变或推进的事：用 matter-draft 存一份待核对草稿，写当前目标、已知现状和一个下一步；看不出该做什么时给 2–3 条可能路径，不预填下一步。
   - 其他内容（一餐、一次训练、一个念头）：不写记录，在每日整理的「原文整理」里写一句可以怎么记，由用户决定。
   - 每条处理完用 inbox done 归档，它就不再算等待整理；原文仍能在资料里读回，草稿留给用户在开图核对、采纳或只留原文。
   - 不创建待办、记录或记忆，不替用户采纳任何草稿或建议。
   - 没有这些工具（例如只能读写云盘文件的云端 Agent）：不动原文，只在每日整理里写还有几条原文待整理。
5. 写 `handoffs/daily/<今天>.md`，frontmatter 为 organizer（你的 Agent 名）、date（YYYY-MM-DD）。
   正文包含「昨天做了什么」（附来源文件）、「当前下一步」（完整清单）、「原文整理」、「未决事项」、「收件箱里还没导入的记录」。
6. 把已整理的交接记录移到 `handoffs/archive/<今天>/`（Kaitu.app 或 DSH 里的 AI 用 kaitu_workspace archive-handoffs）。不删除文件；`inbox/agents/` 里的手机文件只按白天那一节处理，其他文件留给本机导入。
   无法移动时，在每日整理中列出已整理的文件；接手者只读比每日整理新的交接。
7. 拿不准的地方（如两份交接互相矛盾）写进每日整理的「未决事项」，不要猜。
8. 最后按「白天：更新手机」再看一遍有没有活，把新一天的今天准备好。

## 不能做

- 只能由用户本人做的决定：确认阶段、写阶段回顾、启用方向、采纳草稿或建议。也不创建待办、记录或记忆。
- 写外部日历，替用户联系任何人。
- 删除文件。白天处理完的手机文件、夜里归档交接时的移动除外。
- 改下面没列出的地方。能改的只有：
  - 各 STATUS.md 的 next 和 updated（白天按手机操作，夜里按交接）；
  - `NOW.md` 里待确认日程的 status 和 calendar（只按手机操作）；
  - `me/data/tasks/` 末尾追加待办的新版本（只按手机操作）；
  - 把 `inbox/agents/` 里的手机文件移到 `inbox/notes/` 或 `inbox/processed/`；
  - `phone/today.json`、`phone/receipts.json`；
  - 新建 `handoffs/` 下的交接和每日整理，归档已整理的交接；
  - 用开图工具整理原文（夜里第 4 步）。
- 规则、目标、`me/` 和 `memory/` 里除待办以外的内容、各模块 `data/` 里除待办以外的内容、`AGENTS.md` 等本机维护的文件，都只读。
- 把 token 写进任何文件，把资料内容发到资料位置以外的地方。
