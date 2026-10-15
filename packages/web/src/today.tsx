import type { WorkbenchData } from "./api";
import { dateOffset, dayOf } from "./api";
import { type Act, Empty, Markdown, Panel } from "./components";
export function Today({
  data,
  act,
  busy,
  settings,
}: { data: WorkbenchData; act: Act; busy: boolean; settings: () => void }) {
  const next = data.statuses.flatMap((status) =>
    (status.data.next ?? []).map((item) => ({ ...item, file: status.file, module: status.module })),
  );
  const priority = { high: 0, normal: 1, low: 2 };
  const pending = next
    .filter((item) => item.status === "todo")
    .sort((a, b) => priority[a.priority ?? "normal"] - priority[b.priority ?? "normal"]);
  const proposals = next.filter((item) => item.status === "proposed");
  const empty = !data.now.data.date && !data.memories.length && !data.goals.length;
  const weekDay = new Date(`${data.today}T12:00:00Z`).getUTCDay();
  const start = dateOffset(data.today, -((weekDay + 6) % 7));
  const events = data.records.event ?? [];
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: data.timeZone, hour: "2-digit", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
  const greeting = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const current = data.now.data.date === data.today;
  return (
    <>
      <header class="page-heading">
        <p class="eyebrow">
          {new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeZone: data.timeZone }).format(
            new Date(`${data.today}T12:00:00Z`),
          )}
        </p>
        <h1>{greeting}，给今天留一点从容。</h1>
        <p class="muted">看看安排，确认建议，然后开始。</p>
      </header>
      {empty && (
        <Panel title="从这里开始" className="welcome">
          <ol>
            <li>
              <button type="button" onClick={settings}>
                导入 ChatGPT 记忆 →
              </button>
            </li>
            <li>在「我的」了解档案与目标，交给 Agent 补充。</li>
            <li>对 Agent 说「早上好」。</li>
          </ol>
        </Panel>
      )}
      <div class="today-grid">
        <Panel title={current ? "今天的时间线" : "最近的计划"}>
          {!current && data.now.data.date && (
            <p class="notice">这是 {data.now.data.date} 的计划。对 Agent 说「早上好」更新今天。</p>
          )}
          {!data.now.data.blocks?.length && <Empty>还没有今天的安排。对 Agent 说「早上好」。</Empty>}
          <div class="timeline">
            {(data.now.data.blocks ?? [])
              .filter((b) => b.kind !== "task")
              .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
              .map((block) => (
                <div
                  key={block.id}
                  class={`time-row ${block.kind === "proposal" ? "proposal" : ""} ${block.status === "rejected" ? "rejected" : ""}`}
                >
                  <time>
                    {block.start}
                    <small>{block.end}</small>
                  </time>
                  <div class="time-content">
                    <strong>{block.title}</strong>
                    {block.kind === "proposal" && block.status === "pending" ? (
                      <>
                        <p class="muted">Agent 的建议</p>
                        <div class="actions">
                          <button
                            type="button"
                            class="primary"
                            disabled={busy}
                            onClick={() =>
                              act(
                                "proposal",
                                { id: block.id, decision: "confirmed" },
                                "已确认，尚未同步到日历",
                              )
                            }
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act("proposal", { id: block.id, decision: "rejected" }, "已拒绝这条建议")
                            }
                          >
                            不要
                          </button>
                        </div>
                      </>
                    ) : (
                      <p class="muted">
                        {block.kind === "proposal" && block.status === "confirmed"
                          ? "已确认，尚未同步到日历"
                          : {
                              confirmed: "日历已有",
                              rejected: "已拒绝",
                              done: "已完成",
                              skipped: "已跳过",
                              pending: "待处理",
                            }[block.status]}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
          {(data.now.data.blocks ?? [])
            .filter((b) => b.kind === "task")
            .map((task) => (
              <p key={task.id} class="task">
                □ {task.title}
              </p>
            ))}
          {data.now.body && <Markdown text={data.now.body} />}
        </Panel>
        <div class="stack">
          <Panel title="待办与提醒">
            {!data.tasks.length && <Empty>今天没有到期或提醒的待办，也没有过期项。</Empty>}
            {data.tasks.map((task) => (
              <div class="list-row" key={task.id}>
                <div class="grow">
                  <small class="muted">
                    {[task.overdue && "已过期", task.dueToday && "今天到期", task.remindToday && "今天提醒"]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <p>{task.title}</p>
                  {task.due && (
                    <small>
                      截止：
                      {task.due.length === 10
                        ? task.due
                        : new Date(task.due).toLocaleString("zh-CN", { timeZone: data.timeZone })}
                    </small>
                  )}
                  {task.remind_at && (
                    <small>
                      {" "}
                      提醒：{new Date(task.remind_at).toLocaleString("zh-CN", { timeZone: data.timeZone })}
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("tasks/done", { id: task.id }, "已完成待办")}
                >
                  完成
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="需要你处理">
            {data.inboxNotes > 0 && <p>{data.inboxNotes} 条待整理笔记</p>}
            {!(data.now.data.attention?.length || proposals.length || data.inboxNotes) && (
              <Empty>暂时没有需要你处理的事。</Empty>
            )}
            {data.now.data.attention?.map((attention, index) => (
              <div class="list-row" key={`${attention.title}-${index}`}>
                <span class="dot" />
                <span>{attention.title}</span>
              </div>
            ))}
            {proposals.map((item) => (
              <div class="list-row" key={`${item.file}-${item.id}`}>
                <div>
                  <small class="muted">{item.module} · 待讨论</small>
                  <p>{item.title}</p>
                  <small>把这件事告诉 Agent，一起确定下一步。</small>
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="下一步">
            {!pending.length && <Empty>下一步还没定，和 Agent 聊聊现在最重要的事。</Empty>}
            {pending.map((item) => (
              <div class="list-row" key={`${item.file}-${item.id}`}>
                <div class="grow">
                  <small class="muted">
                    {item.module}
                    {item.priority === "high" ? " · 优先" : ""}
                    {item.estimate ? ` · ${item.estimate}` : ""}
                  </small>
                  <p>{item.title}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("next", { file: item.file, id: item.id }, "已完成这一步")}
                >
                  完成
                </button>
              </div>
            ))}
          </Panel>
        </div>
      </div>
      <Panel title="本周日程">
        <div class="week">
          {Array.from({ length: 7 }, (_, i) => {
            const day = dateOffset(start, i);
            const dayEvents = events.filter((event) => {
              const raw = String(event.start);
              const first = raw.length === 10 ? raw : dayOf(raw, data.timeZone);
              const endRaw = String(event.end);
              const end =
                endRaw.length === 10
                  ? endRaw
                  : dayOf(new Date(+new Date(endRaw) - 1).toISOString(), data.timeZone);
              return first <= day && (endRaw.length === 10 ? day < end : day <= end);
            });
            return (
              <div class={`week-day ${day === data.today ? "is-today" : ""}`} key={day}>
                <small>{["一", "二", "三", "四", "五", "六", "日"][i]}</small>
                <strong>{day.slice(8)}</strong>
                {dayEvents.map((event) => (
                  <div class="week-event" key={event.id}>
                    <small>
                      {String(event.start).length === 10
                        ? "全天"
                        : new Intl.DateTimeFormat("zh-CN", {
                            timeZone: data.timeZone,
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }).format(new Date(String(event.start)))}
                    </small>
                    <p>{String(event.title)}</p>
                  </div>
                ))}
                {!dayEvents.length && <span class="muted">—</span>}
              </div>
            );
          })}
        </div>
      </Panel>
      {data.daily && (
        <Panel title="今天的日报">
          <Markdown text={data.daily} />
        </Panel>
      )}
    </>
  );
}
