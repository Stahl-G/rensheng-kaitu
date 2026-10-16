import { useEffect, useRef, useState } from "react";
import type { MeData, MeRules } from "../types.js";
import { AvatarCropDialog } from "./AvatarCropDialog.js";
import css from "./Prototype.module.css";

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
  me: "个人档案",
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void loadMe()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [loadMe]);
  const fact = (memory: MeData["memories"][number]) => (
    <div className={css.fact} key={memory.file}>
      <p>{memory.text}</p>
      <span className={css.src}>
        {sourceLabel(memory.source)}
        {memory.sensitive ? " · 仅本机" : ""}
      </span>
      <span className={css["fact-acts"]}>
        <button
          type="button"
          className={`${css.btn} ${css["btn-quiet"]}`}
          onClick={() =>
            onPrompt(`请读取 memory/${memory.file}，和我修改这条${memoryTypes[memory.type]}，保留出处。`)
          }
        >
          修改
        </button>
      </span>
    </div>
  );
  const facts = data?.memories.filter((memory) => memory.type === "fact") ?? [];
  const preferences = data?.memories.filter((memory) => memory.type === "preference") ?? [];
  const other = data?.memories.filter((memory) => !["fact", "preference"].includes(memory.type)) ?? [];
  return (
    <div className={css["me-body"]}>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onSave={async (base64) => {
            setBusy(true);
            try {
              const avatar = await setAvatar(base64);
              setData((value) => (value ? { ...value, avatar } : value));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {!data ? (
        <p className={css.small}>正在读取档案…</p>
      ) : (
        <>
          <section className={`${css.card} ${css["me-avatar"]}`} aria-label="头像">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                setCropFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={css.avatar}
              aria-label="更换头像"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {data.avatar ? <img src={data.avatar} alt="你的头像" /> : Array.from(data.name ?? "我")[0]}
            </button>
            <span className={css.stack} style={{ flex: "1 1 200px" }}>
              <b>{data.name ?? "还没有填写名字"}</b>
              <span className={css.small}>{data.bio ?? "头像只存在这台电脑上"}</span>
            </span>
            <button
              type="button"
              className={`${css.btn} ${css["btn-quiet"]}`}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              更换头像
            </button>
            {data.avatar && (
              <button
                type="button"
                className={`${css.btn} ${css["btn-quiet"]}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await removeAvatar();
                    setData((value) => (value ? { ...value, avatar: null } : value));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                移除
              </button>
            )}
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>要你确认的推测</h2>
            <p className={css.small}>还没有可显示的推测</p>
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>事实</h2>
            {facts.length ? (
              <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>{facts.map(fact)}</div>
            ) : (
              <p className={css.small}>还没有保存的事实</p>
            )}
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>偏好和规则</h2>
            <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>
              {preferences.map(fact)}
              {ruleRows(data.rules)
                .filter(([, value]) => !!value)
                .map(([label, value]) => (
                  <div className={css.fact} key={label}>
                    <p>
                      {label} · {value}
                    </p>
                    <span className={css.src}>来自 作息与规则 · me/rules.md</span>
                    <span className={css["fact-acts"]}>
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        onClick={() =>
                          onPrompt(`请读取 me/rules.md，和我修改${label}的规则，等我确认再保存。`)
                        }
                      >
                        修改
                      </button>
                    </span>
                  </div>
                ))}
            </div>
          </section>
          {data.goals.length > 0 && (
            <details>
              <summary className={css.link}>我的目标 · {data.goals.length} 项</summary>
              {data.goals.map((goal) => (
                <div className={css.fact} key={goal.id}>
                  <p>{goal.title}</p>
                  <span className={css.src}>
                    {goal.area ? `${areas[goal.area] ?? goal.area} · ` : ""}来自 me/goals.json
                    {goal.due ? ` · ${goal.due} 回看` : ""}
                  </span>
                </div>
              ))}
            </details>
          )}
          {other.length > 0 && (
            <details>
              <summary className={css.link}>其他记忆</summary>
              {other.map(fact)}
            </details>
          )}
          <button
            type="button"
            className={css.link}
            onClick={() => onPrompt("请读取 me/profile.md，和我更新名字和简介，确认后保存。")}
          >
            编辑名字和简介
          </button>
        </>
      )}
    </div>
  );
}
