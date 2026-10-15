import { useCallback, useEffect, useRef, useState } from "react";
import type { MeData, MeRules } from "../types.js";
import css from "./MePage.module.css";
import { avatarBase64 } from "./avatar.js";

export interface MePageProps {
  loadMe: () => Promise<MeData>;
  setAvatar: (base64: string) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
  onPrompt: (text: string) => void;
}
const areas: Record<string, string> = {
  today: "今天",
  health: "健康",
  projects: "在做的事",
  feed: "资讯",
  me: "关于我",
};
const memoryTypes = { preference: "偏好", fact: "事实", context: "背景", person: "人物", decision: "决定" };
const patterns: Record<string, string> = {
  "alternate-days": "隔天一次",
  daily: "每天",
  weekdays: "工作日",
  custom: "自定安排",
};
const periods: Record<string, string> = { morning: "早上", noon: "中午", afternoon: "下午", evening: "晚上" };
function ruleRows(r: MeRules): [string, string | undefined][] {
  const days = r.work_hours?.days;
  const workDays =
    days?.join(",") === "1,2,3,4,5"
      ? "周一到周五"
      : days?.map((day) => `周${"日一二三四五六"[day]}`).join("、");
  return [
    ["时区", r.timezone],
    ["睡觉", r.sleep ? `${r.sleep.start} – ${r.sleep.end}` : undefined],
    [
      "工作",
      r.work_hours
        ? `${workDays ? `${workDays} ` : ""}${r.work_hours.start} – ${r.work_hours.end}`
        : undefined,
    ],
    [
      "训练",
      r.training
        ? [
            r.training.pattern ? (patterns[r.training.pattern] ?? r.training.pattern) : null,
            r.training.duration_min ? `${r.training.duration_min} 分钟` : null,
            r.training.preferred ? (periods[r.training.preferred] ?? r.training.preferred) : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : undefined,
    ],
    ["蛋白质", r.nutrition?.protein_g?.length ? `每天 ${r.nutrition.protein_g.join(" – ")} g` : undefined],
    [r.no_tasks_after ? `${r.no_tasks_after} 后` : "不安排任务", r.no_tasks_after ? "不安排任务" : undefined],
  ];
}
function sourceLabel(source: string | null) {
  if (!source) return "来源未记录";
  if (/chatgpt/i.test(source)) return "ChatGPT 导入";
  if (/^(user|manual|你)$/.test(source)) return "你";
  if (/^(agent|local-agent|本机 Agent)$/.test(source)) return "本机 Agent";
  return source;
}

export function MePage({ loadMe, setAvatar, removeAvatar, onPrompt }: MePageProps) {
  const [data, setData] = useState<MeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    try {
      const result = await loadMe();
      if (seq === sequence.current) setData(result);
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadMe]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const changeAvatar = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const avatar = await setAvatar(await avatarBase64(file));
      setData((d) => (d ? { ...d, avatar } : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const clearAvatar = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeAvatar();
      setData((d) => (d ? { ...d, avatar: null } : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css.page} aria-busy={(!data && !error) || busy}>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {!data ? (
        <p className={css.empty}>{error ? "档案读取失败，请重试。" : "正在读取档案…"}</p>
      ) : (
        <>
          <section className={`${css.card} ${css.profile}`} aria-label="档案">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                void changeAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={css.avatar}
              aria-label="更换头像"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {data.avatar ? (
                <img src={data.avatar} alt="你的头像" />
              ) : (
                Array.from(data.name ?? "?")[0]?.toUpperCase()
              )}
              <span className={css.camera} aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M2.5 5.5h2l1.2-1.8h4.6l1.2 1.8h2v7h-11z" strokeLinejoin="round" />
                  <circle cx="8" cy="9" r="2.2" />
                </svg>
              </span>
            </button>
            <div className={css.identity}>
              <strong>{data.name ?? "还没有填写名字"}</strong>
              <p>{data.bio ?? "还没有一句话简介"}</p>
            </div>
            <div className={css.profileActions}>
              <button type="button" className={css.button} onClick={() => ask("帮我更新档案")}>
                编辑档案
              </button>
              {data.avatar && (
                <button type="button" className={css.link} disabled={busy} onClick={() => void clearAvatar()}>
                  移除头像
                </button>
              )}
              <span className={css.hint}>
                {busy ? "正在保存头像…" : "点头像可更换 · JPG / PNG · 只存在本机"}
              </span>
            </div>
          </section>
          <section aria-label="目标">
            <div className={css.heading}>
              <h2>目标</h2>
              <button type="button" className={css.link} onClick={() => ask("帮我设一个新目标")}>
                新目标
              </button>
            </div>
            <div className={css.goals}>
              {data.goals.map((goal) => (
                <article key={goal.id} className={`${css.card} ${css.goal}`}>
                  <div className={css.goalHeading}>
                    <h3>{goal.title}</h3>
                    {goal.area && (
                      <span className={css.tag} data-area={goal.area}>
                        <i />
                        {areas[goal.area] ?? goal.area}
                      </span>
                    )}
                  </div>
                  {(goal.metric || goal.target) && (
                    <p className={css.secondary}>{[goal.metric, goal.target].filter(Boolean).join(" · ")}</p>
                  )}
                  {goal.approach && (
                    <p>
                      <span className={css.label}>现在的做法</span>
                      {goal.approach}
                    </p>
                  )}
                  {goal.actual && (
                    <p>
                      <span className={css.label}>实际发生</span>
                      {goal.actual}
                    </p>
                  )}
                  {goal.due && <p className={css.due}>{goal.due} 回看</p>}
                </article>
              ))}
            </div>
            {!data.goals.length && <p className={css.empty}>还没有目标，和开图聊聊你想做的事。</p>}
          </section>
          <div className={css.lower}>
            <section className={css.card} aria-label="作息与规则">
              <div className={css.heading}>
                <h2>作息与规则</h2>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => ask("帮我修改作息与规则，请先提出建议，等我确认再改")}
                >
                  修改
                </button>
              </div>
              <dl className={css.rules}>
                {ruleRows(data.rules).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "尚未设置"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className={css.memories} aria-label="AI 记住的你">
              <div className={css.heading}>
                <h2>AI 记住的你</h2>
                {data.memories.length > 4 && (
                  <button
                    type="button"
                    className={css.link}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? "收起" : `全部 ${data.memories.length} 条`}
                  </button>
                )}
              </div>
              {(expanded ? data.memories : data.memories.slice(0, 4)).map((memory) => (
                <div className={css.memory} key={memory.file}>
                  <span className={css.memoryType}>{memoryTypes[memory.type]}</span>
                  <p>{memory.text}</p>
                  <span className={css.source}>
                    {sourceLabel(memory.source)}
                    {memory.sensitive && <span className={css.sensitive}>敏感，仅本机</span>}
                  </span>
                </div>
              ))}
              {!data.memories.length && <p className={css.empty}>还没有保存的记忆。</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
