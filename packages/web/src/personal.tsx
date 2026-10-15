import { useState } from "preact/hooks";
import type { WorkbenchData } from "./api";
import { type Act, Empty, Markdown, Panel } from "./components";
export function Feed({ data }: { data: WorkbenchData }) {
  const [selected, setSelected] = useState("");
  const digest = data.digests.find((item) => item.file === selected) ?? data.digests[0];
  return (
    <>
      <header class="page-heading">
        <p class="eyebrow">关心的事，慢慢读</p>
        <h1>动态</h1>
      </header>
      {digest ? (
        <div class="reading-grid">
          <Panel title="每日简报">
            <div class="document-list">
              {data.digests.map((item) => (
                <button
                  type="button"
                  key={item.file}
                  class={item.file === digest.file ? "selected" : ""}
                  onClick={() => setSelected(item.file)}
                >
                  {item.file.split("/").at(-1)?.replace(".md", "")}
                </button>
              ))}
            </div>
          </Panel>
          <Panel>
            <Markdown text={digest.body} />
          </Panel>
        </div>
      ) : (
        <Panel>
          <Empty>对 Agent 说「早上好」会生成今天的简报。</Empty>
        </Panel>
      )}
      <Panel title="订阅与兴趣">
        <div class="tags">
          {data.feeds.keywords.map((keyword) => (
            <span class="badge" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
        {!data.feeds.feeds.length && <Empty>告诉 Agent 你想关注哪些来源和话题。</Empty>}
        {data.feeds.feeds.map((source, index) => {
          const feed =
            typeof source === "object" && source ? (source as Record<string, unknown>) : { name: source };
          return (
            <div class="list-row" key={String(feed.id ?? index)}>
              <div>
                <strong>{String(feed.name ?? feed.title ?? "订阅源")}</strong>
                <p class="muted">{String(feed.url ?? feed.feed_url ?? "")}</p>
              </div>
            </div>
          );
        })}
      </Panel>
    </>
  );
}
export function Me({ data, act, busy }: { data: WorkbenchData; act: Act; busy: boolean }) {
  const [query, setQuery] = useState("");
  const rules = data.rules.data;
  const memories = data.memories.filter((memory) =>
    `${memory.name} ${memory.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <header class="page-heading">
        <p class="eyebrow">认识自己，也照顾自己</p>
        <h1>我的</h1>
      </header>
      <div class="today-grid">
        <Panel title="档案">
          {data.profile ? (
            <Markdown text={data.profile} />
          ) : (
            <Empty>把基本情况告诉 Agent，从一份简单档案开始。</Empty>
          )}
        </Panel>
        <div class="stack">
          <Panel title="正在前进的目标">
            {!data.goals.length && <Empty>告诉 Agent 你现在最想完成的一件事。</Empty>}
            {data.goals.map((goal) => {
              const status = data.statuses.find((item) => item.file === `${goal.area}/STATUS.md`);
              const progress = status?.data.progress;
              return (
                <div class="goal" key={goal.id}>
                  <h3>{goal.title}</h3>
                  <p class="muted">
                    {goal.metric} {goal.target}
                    {goal.due ? ` · ${goal.due} 前` : ""}
                  </p>
                  {progress && progress.target > 0 ? (
                    <>
                      <progress max={progress.target} value={progress.current} aria-label={goal.title} />
                      <small>
                        {progress.label}：{progress.current} / {progress.target} {progress.unit}
                      </small>
                    </>
                  ) : goal.status === "done" ? (
                    <progress value={1} max={1} aria-label={goal.title} />
                  ) : (
                    <small>进度待 Agent 更新</small>
                  )}
                </div>
              );
            })}
          </Panel>
          <Panel title="作息与目标值">
            <dl>
              <dt>睡眠</dt>
              <dd>{rules.sleep ? `${rules.sleep.start} – ${rules.sleep.end}` : "待填写"}</dd>
              <dt>工作</dt>
              <dd>{rules.work_hours ? `${rules.work_hours.start} – ${rules.work_hours.end}` : "待填写"}</dd>
              <dt>任务截止</dt>
              <dd>{rules.no_tasks_after ?? "待填写"}</dd>
              <dt>训练</dt>
              <dd>{rules.training?.duration_min ? `每次 ${rules.training.duration_min} 分钟` : "待填写"}</dd>
              <dt>蛋白质</dt>
              <dd>{rules.nutrition?.protein_g?.join("–") ?? "待填写"} g / 天</dd>
              <dt>热量缺口上限</dt>
              <dd>{rules.nutrition?.deficit_kcal_max ?? "待填写"} kcal</dd>
            </dl>
          </Panel>
        </div>
      </div>
      <Panel title="项目">
        {!data.projects.length && <Empty>告诉 Agent 你正在做哪些项目。</Empty>}
        {data.projects.map((project) => (
          <div class="goal" key={project.slug}>
            <h3>
              {project.title} · {project.kind === "work" ? "工作" : "个人"} ·{" "}
              {{ idea: "构想", active: "进行中", paused: "暂停", done: "完成" }[project.stage]}
              {project.local_only ? " · 仅本机" : ""}
            </h3>
            <p>
              近 7 天字数变化：{project.recent7.words ?? "—"} · 提交：{project.recent7.commits}
            </p>
            <p>
              下一步：
              {project.next
                .filter((item) => item.status === "todo")
                .map((item) => item.title)
                .join("；") || "待补"}
            </p>
            <p class="muted">最近进展：{project.lastLogDate ?? "待补"}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("projects/sync", { slug: project.slug }, "项目进度已同步")}
            >
              同步进度
            </button>
            <details>
              <summary>状态与进展日志</summary>
              <Markdown text={project.body} />
              <Markdown text={project.log} />
            </details>
          </div>
        ))}
      </Panel>
      <Panel title="现状报告">
        {!data.reports.length && <Empty>积累记录后，让 Agent 做一次现状分析。</Empty>}
        {data.reports.map((report) => (
          <details key={report.file}>
            <summary>{report.file.split("/").at(-1)}</summary>
            <Markdown text={report.body} />
          </details>
        ))}
      </Panel>
      <Panel title="记忆">
        <label class="search">
          搜索记忆{" "}
          <input
            type="search"
            value={query}
            placeholder="名称或内容"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {!memories.length && (
          <Empty>
            {query ? "没有匹配的记忆，试试其他关键词。" : "还没有记忆，可以先导入 ChatGPT 记忆。"}
          </Empty>
        )}
        {memories.map((memory) => (
          <div class="list-row memory" key={memory.file}>
            <div class="grow">
              <strong>{memory.name}</strong>
              <p>{memory.text}</p>
              <small class="muted">
                {memory.updated}
                {memory.sensitive ? " · 敏感" : ""}
              </small>
            </div>
            <button
              type="button"
              class="quiet danger"
              disabled={busy}
              onClick={() =>
                act("memory/delete", { file: memory.file }, "记忆已删除，可在设置的版本历史里恢复。")
              }
            >
              删除
            </button>
          </div>
        ))}
      </Panel>
    </>
  );
}
