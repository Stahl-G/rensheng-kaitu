# 手机与电脑的文件契约

手机只读电脑生成的 `phone/`，只向 `inbox/agents/`、`inbox/health/` 新建文件。
格式以 `schemas/phone-*.schema.json` 与 `schemas/fixtures/phone/` 为准。

## 电脑快照

- `today.json`：前三项下一步、待确认与已确认日程、进行中的目标、同步摘要。`question` 在 v1 为 null。
- `week.json`：最近七天的进行中项目、健康摘要、保存原文数和最近三项变化。
- `map.json`：共用电脑进度行与路线算法，输出城市和经纬度路线。未知或待核对的地点不生成路线。
- `library.json`：资料目录，手机资料页的列表和搜索用。每项是分类（项目、健康、财务、原文、我的）、标题、一行说明、日期和相对路径，不含正文；手机点开哪一项才读那个文件。原文只取第一行作标题（最多 40 字），只列最近 30 天；健康和财务按记录类型各一项，路径是最近一个月的记录文件；记忆全部列出，标为敏感的 subtitle 写「标为敏感」。手机是用户自己的设备，资料目录不替用户藏东西（2026-10-19 用户决定）。
- `receipts.json`：最近十四天的处理结果，`ref` 是操作的 client_id 或收件箱文件名。

每份快照含 format、version、generated_at。today、week、map、library 另有可选的 `generator`：电脑写 `{kind: "computer"}`，云端整理员必须写 `{kind: "agent", name, spec}`（name 不超过 32 字，spec 是 ORGANIZER.md 规则版本）；没有这个字段当作电脑生成。字段只增不改，手机忽略未知字段，遇到不支持的主版本提示升级。
资料变化在后台防抖两秒刷新，监听不可用时每分钟补看；内容不变不写，generated_at 也不变。
只有工作区位于 iCloud / 已配置同步文件夹，或启用 GitHub 备份时才生成四个读快照。
回执由收件箱处理器写入。`phone/` 不作为模块、不进入本机版本历史，Agent 只能读。

投影只取页面需要的字段，不复制正文、项目本机链接或凭据；正文在手机点开时读原文件。
最近变化列最近三个版本，不再按版本说明的文字过滤。file 是工作区内相对路径。

## 手机提交

文件名为 `ios-<8 位小写十六进制设备号>-<大写 ULID>.<后缀>`，每次提交创建新文件。

- `.note.md`：保留 frontmatter 和正文，包括 `agent: 你（iPhone）`、`kind: capture`、`origin: user`、date、created。
- `.records.jsonl`：沿用记录入箱格式。手机文件的 `origin: user` 署名为 `by: user`，assistant 写为 agent。
  缺省 origin 仍按 Agent 记录处理。id、rev、by 由电脑生成。
- 自然记忆使用 `.actions.jsonl` 的 `capture_memory`，只在 `today.mobile.actions` 声明该能力时投递。外层 `origin: assistant` 表示手机 AI 写者；`args.origin` 独立表示 user-stated / ai-estimate / ai-suggestion，不获得额外权限。
  `args` 沿用 `memory_capture` 的原始字段，保留来源、观察时间、原话、不确定性、敏感标记、稳定幂等键及纠正的 replaces/expected。临时/引用/假设跳过，未解冲突不写；重试复用首次 client_id 和全部参数。
  回执新增可选 `memory: { file, status }`，file 为落盘文件名，status 为 saved / duplicate / undone / superseded；既有 `target.id/rev` 不变，旧手机可忽略 memory。只有 applied 且 memory.status=saved 表示新增落盘；undone/superseded 不代表当前事实生效。message 保留文件成功后的索引/版本待重试说明，不能据此宣称版本成功。
  用户撤销或纠正仍可对该 file 使用现有 `replace_memory` 和 expected；缺能力时只保留手机本机结果及待兼容同步状态，不回退到会丢分类字段的旧 `.memory.json`。
- `.actions.jsonl`：逐行按 phone-action schema 校验，按文件内顺序执行。
  执行 complete_next、complete_task、cancel_task、decide_proposal；声明mobile能力的消费者还支持create_task/update_task。其余预留操作返回 rejected。
  decide_proposal 只改今天的状态：确认的日程标 `calendar: phone`，由手机自己写进 Apple 日历，电脑从不替它新建日历事件。
- 健康仍使用 `inbox/health/*.health.json`。照片不在本次实现范围内。

执行前核对下一步仍为 todo、待办仍为 open、日程建议仍待确认。

### 手机确认日程

1. 用户在手机上点「确认」，App 用 EventKit 把日程写进「开图」日历（需日历权限），提前 10 分钟提醒，
   备注写 `开图记录：<日期>/<时间段 id>`，与电脑写入的格式一致。iCloud 会把它同步到电脑。
2. 写完再交 `decide_proposal`（confirmed）。电脑把这条标为已确认、`calendar: phone`。
3. 没有日历权限时照样交操作，界面说明「没有日历权限，只记在开图里」。点「不要」交 rejected。
4. Mac 推系统日历时按备注在所有名为「开图」的日历里找这条：找到了（iCloud 已同步过来）就跟着更新，
   这时也能在电脑上改时间，改动经 iCloud 回到手机；没找到就等下次，不新建。Windows 读不了 Apple 日历，只能在 iPhone 上改。

### 可信边界

收件箱文件没有签名，也不带用户手势证明；能写资料位置的 Agent 都能造出同名的手机文件。
所以手机文件只拿到 Agent 的权限，origin 只决定署名，不是授权，核对当前状态也不等于认证来源。

- 照常收：原文、普通记录，以及 Agent 本来就能做的操作（完成下一步、完成或取消待办）。
- 日程建议：确认或拒绝只改开图里的状态；写日历这一步只在手机上、由用户点按后发生。
  伪造的文件最多改动开图里的一个状态，写不进用户的日历。
- 不生效：只能由用户本人做的决定。确认阶段、写阶段回顾、启用方向按 Agent 权限校验，整份拒绝，在电脑上确认。
- 未交付：手机可信确认通道。需要设备配对和签名之类的来源证明，本期不做，也不新增凭据或授权。
不满足返回 conflict；格式错误或未支持操作返回 rejected。
操作 client_id 的处理账本留在本机状态目录，独立于十四天回执保留期，重启后仍去重；`phone/receipts.json` 里已有的 client_id（例如云端整理员处理过的）也算处理过。
同一个 client_id 再投递不重复执行：第一次成功的返回 duplicate，第一次 conflict 或 rejected 的照原结果再返回。
conflict 说明这一项已经在电脑上变了，不需要再到电脑上处理，所以不计入电脑今天页的「需要核对」；回执供手机撤回乐观显示并呈现原因。
成功文件移到 processed，原文进入 notes；不合格记录附原因进入待整理笔记。

## GitHub 与同步文件夹

GitHub 连接启用后，phone 四个 JSON 始终以本机为准上传，只有远端回执里本机没有的条目先并进本机；
agents 文本、health JSON 收件箱和 `inbox/notes/` 下的待整理原文始终双向同步，不受文字 / 结构化资料开关影响。电脑拉下新文件后，下一轮上传回执和快照；处理完的远端收件箱文件删除。
网络期间本机文件有变化时保留本机内容，下轮重试。原有同记录冲突规则、Host / Origin 和 Agent / MCP 写入策略保留。

iCloud 和其他同步文件夹直接交换同样的路径，无需额外协议。真实手机、真实同步盘和真实 GitHub 的联调另行验收。

## 本机基础事项与修订同步（2026-10-19）

手机即使未连接或没有today也能在本机创建、查看、编辑、完成/取消待办及保存/回读笔记，先原子持久化，再显示结果。
本机完成与跨端应用分开。笔记从inbox消失不能作为成功证据；file applied只说明已收下，不代表整理完成。

新版today可选mobile={version:1,actions:[...],tasks:[{id,rev,title,status,ts,due?}]}，tasks包括完成/取消项。
缺少能力声明时，新任务与修订保留手机上，不投递给旧消费者；已有四动作的旧格式继续兼容。
新建create_task的args含稳定ULID id、title、expected_rev:0，可有due/notes；正式记录rev1，id不再重生。
update_task只允许title/due/notes与expected_rev；complete/cancel携带expected_rev。保留字段by/rev/deleted不能由客户端指定。
回执可带target:{id,rev}。当前rev不匹配则conflict，保留两端内容，不静默覆盖。
同target前序未取得真实成功回执前不投后续动作，本机继续编辑不受阻；不用文件名字典序假定跨文件到达顺序。

next可选source_precondition是所见目标条目原对象，complete_next.args.expected_next原样带回；
消费者比较该条目精确内容后才完成，不给所有STATUS额外增加修订框架。

消费者在已有phone-actions账本先保存受控任务的准备记录，再通过现有record-transaction追加。
中断后重投同client_id复用准备记录，已有相同rev/内容不再追加；终态账本成功后才发布回执。
不同内容的同rev或陈旧目标返回冲突；持久化故障保留作业可重试，不落永久conflict。
手机仍只新建inbox，不能伪写phone快照或desktop receipt。实际跨语言文件旅程另行验证，真机/同步盘验收不由合成测试代替。

## 饮食合计（2026-10-20）

开了饮食模块时，today 带 `nutrition: {version:1, kcal, protein_g, accounted_refs}`：kcal、protein_g 是 today 当天（按 timezone）所有饮食记录的合计；accounted_refs 是电脑已经入账的手机 `.records.jsonl` 文件名，撤回、替换过的也留着。
手机显示时用这份合计，再加上本机确认过、但文件名不在 accounted_refs 里的饮食。没有 nutrition 或 version 不认识时，只显示本机确认的饮食。

## 单行结果与短时撤销（result_contract 1）

发送时同时检查新鲜 today 的 `mobile.result_contract === 1`、`mobile.actions` 包含动作，并保留客户端原有电脑快照水位检查。mobile.version 仍是 1。只看 adopt_task 名称不够：旧电脑已声明该名称却忽略 expected_rev，绝不退回无 CAS 的采纳。缺能力时保留原操作 ID、内容和草稿，等待兼容电脑，不改写为旧 complete_next/complete_task。

`applyResultAction` 的 client_id 与手机一致，只接受 26 位 ULID；桌面旧 UUID 调用须改为 ULID，不会隐式转换，重试复用原 ULID。

每个新操作一个独立 `.actions.jsonl` 文件，只含一行 JSON；同目标上一次未知结果未核清前不提交后续操作。重投必须沿用原 client_id 和全部原参数。不同内容重用 ID 返回 conflict。文件消失、文件级收件成功均不是动作已完成的证明。

- `complete_next_result`：args `{file,id,result_text,expected_rev}`（task）或 `{file,id,result_text,expected_next}`（STATUS）。任务须 open，STATUS 须 todo，前提精确匹配才完成。结果允许空白，空白不计推进；新输入必须单行且最多 2000 字符，换行/超长显式 rejected，不截断不折叠。旧多行草稿保留待修改，用新 ID 提交修改后的操作；未知结果不得因此换 ID 重试。
- `adopt_task`：args `{id,expected_rev}`，只把 proposed 采纳为 open；旧无 expected_rev 形式兼容既有入口，但新客户端不发送它。
- `cancel_task`：args `{id,expected_rev}`，允许 open 或 proposed 变为 cancelled；建议的“不采用”复用此动作。
- `restore_task_revision`：args `{id,expected_rev,prior_rev}`，仅在当前修订匹配时，把已有旧修订的内容追加为 rev+1，不重写历史。
- `restore_next`：args `{file,id,expected_next,prior_next}`，只在当前目标条目完整等于 expected_next 时恢复 prior_next；其他条目、未知字段和正文保留。独立修改目标条目返回 conflict。

成功/重复回执含 `effect`。task 为 `{file:"task",id,rev,prior_rev}`，STATUS 为 `{file,id,expected_next,prior_next}`。短时撤销提示把 effect 转成上面的恢复动作，分配新的 client_id。该回执不是永久撤销列表，mobile.results 不提供历史撤销。I/O 结果未知保留本机持久请求与写前计划，重启重投原 ID；已写修订不再追加，已撤销操作不重放。STATUS 的前提是数据精确值，未知写入尚未沿原 ID 核清，外部工具就恢复为相同旧值的 ABA 无法从两个业务字段识别，不声称有来源所有权。

例：`{"client_id":"01K00000000000000000000001","at":"2026-11-11T08:00:00Z","device":"3fa9c1d2","op":"complete_next_result","args":{"file":"task","id":"01K00000000000000000000002","expected_rev":1,"result_text":"完成初稿"}}`。
回执 effect `{file:"task",id:"01K00000000000000000000002",rev:2,prior_rev:1}` 对应恢复 args `{id:"01K00000000000000000000002",expected_rev:2,prior_rev:1}`。

任务继续用 notes 中的「完成结果：」「完成时间：」，来源链接与旧多行内容保留。STATUS 的 next 条目只增加可选 `result` 与 `completed`；completed 取名参考 [RFC 5545 §3.8.2.1 COMPLETED](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.2.1)，存带时区的 ISO 8601；结果没有对应的专用 iCalendar 属性，采用普通 result。正文不增加机器块或 HTML 注释。

core 的 collectResults / resultActivityDays 同时给桌面 overview.results/resultActivityDays 和 phone.today.mobile.results/activity_days 提供数据，不依赖手机操作账本。只列当前有效非空完成结果，恢复为未完成后移出列表但历史仍在。按工作区本地时区，含今天的七个自然日去重；同日两条结果是两行、一天。task 追溯本次完成的修订来源，后续改标题/到期日不丢结果或把 Agent 完成升级成用户完成；任务旧结果缺有效带时区完成时间时保留原 notes 原文，不进入有日期的结果集合或七天日期。STATUS 显式 result+completed 计入日期，但没有作者字段，无法区分 AI 写入的显式结果，不能宣称排除了全部 AI 结果。

旧候选的 results DTO 仍能读取 completion_id/file/id/title/text/completed_at/can_undo。这里 completion_id 是 `data:<编码file>:<编码id>` 显示键，不是原操作 ID，can_undo 恒为 false。新客户端只用 file+id 作为数据 identity，撤销只用回执 effect 和新动作，不能把显示键交给旧 undo_next_result。旧候选若发送多行结果，得到 rejected，保留原稿；不静默丢内容。

旧 main 不认识 complete_next_result/restore_task_revision/restore_next，逐行拒绝后归档原文件；保留客户端原请求与 ID，升级后才能重投。旧主线混合文件可能已经执行其中合法行，同时给整个文件 rejected，不能宣称整文件未执行。新消费者不把未知动作解释成别的动作，原文件归档保留；若曾收到终态 conflict/rejected，修改后应使用新 ID，若仅有旧版文件级拒绝且证实目标未执行，可原 ID 重投。

### 桌面结果输入的本机待处理状态

桌面今天与目标结果共用上述结果集合和修订操作。活动点阵与天数只计用户结果，或来源未知的显式 STATUS 结果；损坏修订历史导致来源未知的 task 仍可显示，但不计活动。这个局部活动量不等于完整产品北极星。

桌面通过 `resultDraft` 在 Workspace 已有 state binding 的 `.kaitu/result-draft.json` 保存未完成草稿和唯一未确认操作的原始 ULID、完整 payload、原文及展示目标。文件沿现有本机状态目录，以 0600 临时文件加原子 rename 写入；不写 `phone/`、用户事项字段或成功操作历史。整份前值作 CAS，丢失保存响应时先确认原保存，不能用后来的草稿覆盖另一窗口。独立 App 每次使用随机本机 HTTP 端口，因此不依赖浏览器 origin 的 localStorage 跨重启保留。

加载失败时不覆盖原稿、不首次发送结果。原始待处理状态落盘成功后才调用结果操作；结果响应未知时保留同一 ID、payload 和草稿，阻止新操作，重启后仅加载，不自动重放。用户重试后再回读共享投影。`duplicate` 只确认原请求已执行，不表示其旧 effect 现在仍生效，不重建完成提示或 Undo。

确认 applied 后，只清除仍与本次文字相同的完成草稿。刚完成/决定的 Undo 只保留五秒内存提示；离页、切工作区或重启后不恢复，原异步响应也不能重新显示已离开的提示。Undo 使用新 ULID 与原 effect 的数据前提恢复，冲突保留后来的编辑；不接管全局 Cmd-Z。先前完成原文在这五秒内用于恢复输入，成功建议的状态文案不成为结果草稿。

STATUS 的外部 ABA 限制仍适用：原结果未知期间，条目被外部改走又逐字改回，只有两个结果字段不能完整识别。正常确认完成、Undo、原 ID 重试由共享账本保证不重放。
