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

## 人生地图只读投影

`phone/life-atlas.json` 是可丢弃的版本 1 快照（`format: kaitu.phone.life-atlas`），
沿现有文件夹或 GitHub 手机快照通道发布；不改变业务资料、地图存档或 `phone/map.json`。
旧手机忽略新文件；缺少此文件表示桌面尚未发布，`resource: null` 表示尚未采用地图。

字段：`generated_at` 为资料投影时间；`resourceId` 是既有候选 ID；`resource` 原样使用
Cartographer AtlasResource（SVG、尺寸、margin、regions、compass、settings）；
`domains` 复用当前 AtlasDomain（既有 slot、facts、temporal、score）；仅视觉渐淡的 clarity / freshness
取百分之一精度，避免不可见的分钟变化重复上传整张 SVG。另有 `coverage`、`gaps`。
不发布候选历史、缓存或本机路径。采用地图、源资料变化和重新启动会触发后台投影；
资料读取失败保留已发布快照，UI 按快照时间展示。生成失败仍可发布原采用地图。
手机只读，首版不生成、不采用、不改写地图。

人生地图保留用户已采用的全部领域（包括财务），仅供手机 UI 查看。
不传重复携带事实的 facets；手机只使用 id/title/slot/facts/temporal/score。
桌面 agentCanRead 与 iOS AskWorkspace 在读取入口拒绝 phone/life-atlas.json 和 phone/library.json，
同时检查实际路径，链接别名也不能绕过；人可视页面仍通过既有 WorkspaceStore.read 读取。
现有公共导航只使用过滤过的 library.navigation，不增加这些混合快照或地图事实到 AI 薄上下文。

单份 UTF-8 JSON 上限与手机一致，均为 16 MiB；超限时保留上次快照并报告错误。
SVG、区域与领域资料封装于同一个 JSON，使用既有临时文件 + rename 原子写入；
Drive 沿用读取前后版本核对，GitHub 沿用文件 blob 版本，手机在验证成功后才替换缓存。
