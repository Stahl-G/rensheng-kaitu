# 手机与电脑的文件契约

手机只读电脑生成的 `phone/`，只向 `inbox/agents/`、`inbox/health/` 新建文件。
格式以 `schemas/phone-*.schema.json` 与 `schemas/fixtures/phone/` 为准。

## 电脑快照

- `today.json`：前三项下一步、待确认与已确认日程、进行中的目标、同步摘要。`question` 在 v1 为 null。
- `week.json`：最近七天的进行中项目、健康摘要、保存原文数和最近三项变化。
- `map.json`：共用电脑进度行与路线算法，输出城市和经纬度路线。未知或待核对的地点不生成路线。
- `receipts.json`：最近十四天的处理结果，`ref` 是操作的 client_id 或收件箱文件名。

每份快照含 format、version、generated_at。字段只增不改，手机忽略未知字段，遇到不支持的主版本提示升级。
资料变化在后台防抖两秒刷新，监听不可用时每分钟补看；内容不变不写，generated_at 也不变。
只有工作区位于 iCloud / 已配置同步文件夹，或启用 GitHub 备份时才生成三个读快照。
回执由收件箱处理器写入。`phone/` 不作为模块、不进入本机版本历史，Agent 只能读。

投影只取页面需要的字段，不复制原文、项目本机链接、财务明细、记忆或凭据。
最近变化排除财务和记忆类版本说明。file 是工作区内相对路径。

## 手机提交

文件名为 `ios-<8 位小写十六进制设备号>-<大写 ULID>.<后缀>`，每次提交创建新文件。

- `.note.md`：保留 frontmatter 和正文，包括 `agent: 你（iPhone）`、`kind: capture`、`origin: user`、date、created。
- `.records.jsonl`：沿用记录入箱格式。手机文件的 `origin: user` 署名为 `by: user`，assistant 写为 agent。
  缺省 origin 仍按 Agent 记录处理。id、rev、by 由电脑生成。
- `.actions.jsonl`：逐行按 phone-action schema 校验，按文件内顺序执行。
  执行 complete_next、complete_task、cancel_task、decide_proposal。预留操作返回 rejected。
  decide_proposal 只改今天的状态：确认的日程标 `calendar: phone`，由手机自己写进 Apple 日历，电脑不再写系统日历；
  这条日程的时间也只能在 iPhone 上改。
- 健康仍使用 `inbox/health/*.health.json`。照片不在本次实现范围内。

执行前核对下一步仍为 todo、待办仍为 open、日程建议仍待确认。

### 手机确认日程

1. 用户在手机上点「确认」，App 用 EventKit 把日程写进「开图」日历（需日历权限），提前 10 分钟提醒，
   备注写 `开图记录：<日期>/<时间段 id>`，与电脑写入的格式一致。iCloud 会把它同步到电脑。
2. 写完再交 `decide_proposal`（confirmed）。电脑把这条标为已确认、`calendar: phone`，推系统日历时跳过它。
3. 没有日历权限时照样交操作，界面说明「没有日历权限，只记在开图里」。点「不要」交 rejected。

### 可信边界

收件箱文件没有签名，也不带用户手势证明；能写资料位置的 Agent 都能造出同名的手机文件。
所以手机文件只拿到 Agent 的权限，origin 只决定署名，不是授权，核对当前状态也不等于认证来源。

- 照常收：原文、普通记录，以及 Agent 本来就能做的操作（完成下一步、完成或取消待办）。
- 日程建议：确认或拒绝只改开图里的状态；写日历这一步只在手机上、由用户点按后发生。
  伪造的文件最多改动开图里的一个状态，写不进用户的日历。
- 不生效：只能由用户本人做的决定。确认阶段、写阶段回顾、启用方向按 Agent 权限校验，整份拒绝，在电脑上确认。
- 未交付：手机可信确认通道。需要设备配对和签名之类的来源证明，本期不做，也不新增凭据或授权。
不满足返回 conflict；格式错误或未支持操作返回 rejected。
操作 client_id 的处理账本留在本机状态目录，独立于十四天回执保留期，重启后仍去重。
同一个 client_id 再投递不重复执行：第一次成功的返回 duplicate，第一次 conflict 或 rejected 的照原结果再返回。
conflict 说明这一项已经在电脑上变了，不需要再到电脑上处理，所以不计入电脑今天页的「需要核对」；回执供手机撤回乐观显示并呈现原因。
成功文件移到 processed，原文进入 notes；不合格记录附原因进入待整理笔记。

## GitHub 与同步文件夹

GitHub 连接启用后，phone 四个 JSON 始终只上传，agents 文本与 health JSON 收件箱始终双向同步，
不受文字 / 结构化资料开关影响。电脑拉下新文件后，下一轮上传回执和快照；处理完的远端收件箱文件删除。
网络期间本机文件有变化时保留本机内容，下轮重试。原有同记录冲突规则、Host / Origin 和 Agent / MCP 写入策略保留。

iCloud 和其他同步文件夹直接交换同样的路径，无需额外协议。真实手机、真实同步盘和真实 GitHub 的联调另行验收。
