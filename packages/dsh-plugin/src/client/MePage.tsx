import { type ReactNode, useEffect, useRef, useState } from "react";
import type { MeData, MeRules } from "../types.js";
import { AvatarCropDialog } from "./AvatarCropDialog.js";
import css from "./Prototype.module.css";
import { ReadWarnings } from "./ReadWarnings.js";
import { useT } from "./i18n.js";
import { memoryDisplayText } from "./memory-presentation.js";

/** 人生展览是关于你自己的作品，入口放在个人档案的操作里，不占今天页。 */
export function ExhibitionEntry({
  file,
  open,
  generate,
}: {
  file: string | null;
  open: (file: string) => Promise<{ opened: boolean }>;
  generate: () => void;
}) {
  const t = useT();
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openFile = async () => {
    if (!file || opening.current) return;
    opening.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await open(file);
      if (!result.opened) setError(t("展览文件已变更", "The exhibition file has changed"));
    } catch {
      setError(t("未能打开展览，请重试", "Couldn’t open the exhibition. Try again."));
    } finally {
      setBusy(false);
      opening.current = false;
    }
  };
  return (
    <>
      <button
        type="button"
        className={`${css.btn} ${css["btn-quiet"]}`}
        disabled={busy}
        onClick={(event) => {
          if (event.detail > 1) return;
          if (file) void openFile();
          else generate();
        }}
      >
        {file
          ? t("打开人生展览", "Open life exhibition")
          : t("生成我的人生展览", "Create my life exhibition")}
      </button>
      {file && (
        <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} disabled={busy} onClick={generate}>
          {t("重新生成", "Create again")}
        </button>
      )}
      {error && <output className={css.small}>{error}</output>}
    </>
  );
}

const GOAL_SOURCES: Record<string, [string, string]> = {
  chatgpt: ["从 ChatGPT 搬来", "From ChatGPT"],
  claude: ["从 Claude 搬来", "From Claude"],
  gemini: ["从 Gemini 搬来", "From Gemini"],
  doubao: ["从豆包搬来", "From Doubao"],
  other: ["从 AI 搬来", "From an AI"],
  note: ["你写下的", "You wrote it"],
  conversation: ["来自一段对话", "From a conversation"],
};

export type MemoryExpectation = Pick<
  MeData["memories"][number],
  "type" | "name" | "text" | "source" | "sensitive"
>;
function expectedMemory(memory: MeData["memories"][number]): MemoryExpectation {
  return {
    type: memory.type,
    name: memory.name,
    text: memory.text,
    source: memory.source,
    sensitive: memory.sensitive,
  };
}

export interface MePageProps {
  loadMe: () => Promise<MeData>;
  archiveMemory: (file: string, expected: MemoryExpectation) => Promise<unknown>;
  replaceMemory: (
    file: string,
    candidate: MeData["memoryReplacements"][number]["candidate"],
    expected: MemoryExpectation,
  ) => Promise<unknown>;
  setAvatar: (base64: string) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
  onPrompt: (text: string) => void;
  onImportMemory: () => void;
  exhibition?: ReactNode;
}
const areas: Record<string, readonly [string, string]> = {
  today: ["今天", "Today"],
  health: ["健康", "Health"],
  projects: ["在做的事", "Projects"],
  feed: ["资讯", "News"],
  me: ["个人档案", "Profile"],
};
const memoryTypes = {
  preference: ["偏好", "preference"],
  fact: ["事实", "fact"],
  context: ["背景", "context"],
  person: ["人物", "person"],
  decision: ["决定", "decision"],
} as const;
const patterns: Record<string, readonly [string, string]> = {
  "alternate-days": ["隔天一次", "Every other day"],
  daily: ["每天", "Daily"],
  weekdays: ["工作日", "Weekdays"],
  custom: ["自定安排", "Custom"],
};
const periods: Record<string, readonly [string, string]> = {
  morning: ["早上", "Morning"],
  noon: ["中午", "Noon"],
  afternoon: ["下午", "Afternoon"],
  evening: ["晚上", "Evening"],
};
const weekdaysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ruleRows(r: MeRules, t: Translate): [string, string | undefined][] {
  const days = r.work_hours?.days;
  const workDays =
    days?.join(",") === "1,2,3,4,5"
      ? t("周一到周五", "Mon–Fri")
      : days
          ?.map((day) => t(`周${"日一二三四五六"[day]}`, weekdaysEn[day] ?? String(day)))
          .join(t("、", ", "));
  return [
    [t("时区", "Time zone"), r.timezone],
    [t("睡觉", "Sleep"), r.sleep ? `${r.sleep.start} – ${r.sleep.end}` : undefined],
    [
      t("工作", "Work"),
      r.work_hours
        ? `${workDays ? `${workDays} ` : ""}${r.work_hours.start} – ${r.work_hours.end}`
        : undefined,
    ],
    [
      t("训练", "Training"),
      r.training
        ? [
            r.training.pattern
              ? patterns[r.training.pattern]
                ? t(patterns[r.training.pattern]?.[0] ?? "", patterns[r.training.pattern]?.[1] ?? "")
                : r.training.pattern
              : null,
            r.training.duration_min
              ? t(`${r.training.duration_min} 分钟`, `${r.training.duration_min} min`)
              : null,
            r.training.preferred
              ? periods[r.training.preferred]
                ? t(periods[r.training.preferred]?.[0] ?? "", periods[r.training.preferred]?.[1] ?? "")
                : r.training.preferred
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : undefined,
    ],
    [
      t("蛋白质", "Protein"),
      r.nutrition?.protein_g?.length
        ? t(`每天 ${r.nutrition.protein_g.join(" – ")} g`, `${r.nutrition.protein_g.join(" – ")} g / day`)
        : undefined,
    ],
    [
      r.no_tasks_after
        ? t(`${r.no_tasks_after} 后`, `After ${r.no_tasks_after}`)
        : t("不安排任务", "No tasks"),
      r.no_tasks_after ? t("不安排任务", "No tasks scheduled") : undefined,
    ],
  ];
}
function sourceLabel(source: string | null, t: Translate) {
  if (!source) return "";
  if (/chatgpt/i.test(source)) return t("ChatGPT 导入", "ChatGPT import");
  if (/^(user|manual|你)$/.test(source)) return t("你", "You");
  if (/^(agent|local-agent|本机 Agent)$/.test(source)) return t("本机 Agent", "Local Agent");
  return source;
}

type Translate = (zh: string, en: string) => string;
type CareerItem = MeData["career"][number];

function period(item: CareerItem, t: Translate): string {
  if (!item.start) return t("时间未知", "Dates unknown");
  return `${item.start} – ${item.end ?? t("结束时间未记录", "End date not recorded")}`;
}

/** 简历由经历生成：工作在前，读书在后，各自从近到远。 */
export function downloadResume(data: MeData, t: Translate) {
  const lines = [`# ${data.name ?? t("简历", "Résumé")}`, ""];
  if (data.bio) lines.push(data.bio, "");
  for (const [kind, heading] of [
    ["worked", t("工作经历", "Work")],
    ["studied", t("教育经历", "Education")],
  ] as const) {
    const items = data.career.filter((item) => item.kind === kind);
    if (!items.length) continue;
    lines.push(`## ${heading}`, "");
    for (const item of items) lines.push(`- ${period(item, t)} · ${item.title} · ${item.place}`);
    lines.push("");
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.name ?? "resume"}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function MePage({
  loadMe,
  archiveMemory,
  replaceMemory,
  setAvatar,
  removeAvatar,
  onPrompt,
  onImportMemory,
  exhibition,
}: MePageProps) {
  const t = useT();
  const [data, setData] = useState<MeData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [confirmRemoveAvatar, setConfirmRemoveAvatar] = useState(false);
  const [replacement, setReplacement] = useState<MeData["memories"][number] | null>(null);
  const [replacementText, setReplacementText] = useState("");
  const mutateMemory = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setData(await loadMe());
      setReplacement(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
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
      <p>{memoryDisplayText(memory)}</p>
      <span className={css.src}>
        {[
          memory.origin
            ? t(
                {
                  "user-stated": "用户陈述",
                  "ai-estimate": "AI 估算 · 未核实",
                  "ai-suggestion": "AI 建议 · 尚未采纳",
                }[memory.origin] ?? memory.origin,
                {
                  "user-stated": "Stated by you",
                  "ai-estimate": "AI estimate · unverified",
                  "ai-suggestion": "AI suggestion · not adopted",
                }[memory.origin] ?? memory.origin,
              )
            : "",
          memory.observed_at ?? "",
          memory.origin ? memory.source : sourceLabel(memory.source, t),
          memory.sensitive ? t("敏感 · 不进资料包", "Sensitive · left out of packs") : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {memory.uncertainty && <p className={css.src}>{memory.uncertainty}</p>}
      {memory.evidence && memory.evidence !== memoryDisplayText(memory) && (
        <details>
          <summary>{t("原话与依据", "Evidence")}</summary>
          <p>{memory.evidence}</p>
        </details>
      )}
      {memory.ended && (
        <span className={css.src}>
          {memory.replaced_by
            ? t(
                `于 ${memory.ended} 替换为：${[...(data?.memories ?? []), ...(data?.archivedMemories ?? [])].find((item) => item.file === memory.replaced_by)?.name ?? memory.replaced_by}`,
                `Replaced on ${memory.ended}: ${[...(data?.memories ?? []), ...(data?.archivedMemories ?? [])].find((item) => item.file === memory.replaced_by)?.name ?? memory.replaced_by}`,
              )
            : t(`于 ${memory.ended} 归档`, `Archived on ${memory.ended}`)}
        </span>
      )}
      {!memory.ended && (
        <span className={css["fact-acts"]}>
          <button
            type="button"
            className={`${css.btn} ${css["btn-quiet"]}`}
            onClick={() =>
              onPrompt(
                t(
                  `请读取 memory/${memory.file}，和我修改这条${memoryTypes[memory.type]?.[0] ?? "记忆"}，保留出处。`,
                  `Read memory/${memory.file} and help me update this ${memoryTypes[memory.type]?.[1] ?? "memory"}, keeping its source.`,
                ),
              )
            }
          >
            {t("修改", "Edit")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css["btn-quiet"]}`}
            disabled={busy}
            aria-expanded={replacement?.file === memory.file}
            onClick={() => {
              if (replacement?.file === memory.file) {
                setReplacement(null);
              } else {
                setReplacement(memory);
                setReplacementText(memory.text);
              }
            }}
          >
            {replacement?.file === memory.file
              ? t("收起", "Close")
              : t("用新说法替换", "Replace with new wording")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css["btn-quiet"]}`}
            disabled={busy}
            onClick={() => void mutateMemory(() => archiveMemory(memory.file, expectedMemory(memory)))}
          >
            {memory.origin
              ? t("撤销这条自动记录", "Undo this automatic memory")
              : t("这条不再成立", "This no longer applies")}
          </button>
        </span>
      )}
      {replacement?.file === memory.file && (
        <form
          className={`${css.card} ${css["sub-form"]}`}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing && !busy) {
              event.preventDefault();
              setReplacement(null);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !replacementText.trim()) return;
            void mutateMemory(() =>
              replaceMemory(
                replacement.file,
                {
                  type: replacement.type,
                  name: replacement.name,
                  text: replacementText,
                  ...(replacement.source ? { source: replacement.source } : {}),
                  sensitive: replacement.sensitive,
                },
                expectedMemory(replacement),
              ),
            );
          }}
        >
          <label>
            {t("新的说法", "New wording")}
            <textarea
              required
              // biome-ignore lint/a11y/noAutofocus: 点击用新说法替换后直接聚焦输入框。
              autoFocus
              disabled={busy}
              value={replacementText}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onChange={(event) => setReplacementText(event.target.value)}
            />
          </label>
          <div className={css["dialog-foot"]}>
            <button type="button" className={css.link} disabled={busy} onClick={() => setReplacement(null)}>
              {t("取消", "Cancel")}
            </button>
            <button
              type="submit"
              className={`${css.btn} ${css["btn-primary"]}`}
              disabled={busy || !replacementText.trim()}
            >
              {t("确认替换", "Confirm replacement")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
  const facts = data?.memories.filter((memory) => memory.type === "fact") ?? [];
  const preferences = data?.memories.filter((memory) => memory.type === "preference") ?? [];
  const other = data?.memories.filter((memory) => !["fact", "preference"].includes(memory.type)) ?? [];
  const goals =
    data?.goals.filter((goal) => !goal.status || ["active", "paused"].includes(goal.status)) ?? [];
  return (
    <div className={css["me-body"]}>
      <ReadWarnings warnings={data?.warnings} />
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
        <p className={css.small}>{t("正在读取档案…", "Loading profile…")}</p>
      ) : (
        <>
          <section className={`${css.card} ${css["me-avatar"]}`} aria-label={t("头像", "Avatar")}>
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
              aria-label={t("更换头像", "Change avatar")}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {data.avatar ? (
                <img src={data.avatar} alt={t("你的头像", "Your avatar")} />
              ) : (
                Array.from(data.name ?? t("我", "M"))[0]
              )}
            </button>
            <span className={css.stack} style={{ flex: "1 1 200px" }}>
              <b>{data.name ?? t("我", "Me")}</b>
              <span className={css.small}>{data.bio}</span>
            </span>
            {exhibition}
            <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={onImportMemory}>
              {t("从 AI 搬来记忆", "Bring memories from your AI")}
            </button>
            <button
              type="button"
              className={`${css.btn} ${css["btn-quiet"]}`}
              disabled={busy}
              onClick={() => {
                setConfirmRemoveAvatar(false);
                input.current?.click();
              }}
            >
              {t("更换头像", "Change avatar")}
            </button>
            {data.avatar &&
              (confirmRemoveAvatar ? (
                <>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await removeAvatar();
                        setConfirmRemoveAvatar(false);
                        setData((value) => (value ? { ...value, avatar: null } : value));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("确认移除", "Confirm remove")}
                  </button>
                  <button
                    type="button"
                    className={css.link}
                    disabled={busy}
                    onClick={() => setConfirmRemoveAvatar(false)}
                  >
                    {t("取消", "Cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-quiet"]}`}
                  disabled={busy}
                  onClick={() => setConfirmRemoveAvatar(true)}
                >
                  {t("移除", "Remove")}
                </button>
              ))}
          </section>
          <section className={css.sec}>
            <div className={css["sec-head"]}>
              <h2 className={css.eyebrow}>{t("经历", "Experience")}</h2>
              {data.career.length > 0 && (
                <button type="button" className={css.link} onClick={() => downloadResume(data, t)}>
                  {t("导出简历", "Export résumé")}
                </button>
              )}
            </div>
            {data.career.length ? (
              <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>
                {data.career.map((item) => (
                  <div className={css.fact} key={item.id}>
                    <p>{item.title}</p>
                    <span className={css.src}>
                      {period(item, t)} · {item.place}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={css.small}>{t("还没有读书或工作经历", "No study or work history yet")}</p>
            )}
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("我的目标", "My goals")}</h2>
            {goals.length ? (
              <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>
                {goals.map((goal) => {
                  const origin =
                    /^(chatgpt|claude|gemini|doubao|other|note|conversation)-(\d{4})(\d{2})(\d{2})-/.exec(
                      goal.id,
                    );
                  const source = origin ? GOAL_SOURCES[origin[1] as string] : undefined;
                  return (
                    <div className={css.fact} key={goal.id}>
                      <p>{goal.title}</p>
                      <span className={css.src}>
                        {goal.area
                          ? `${areas[goal.area] ? t(areas[goal.area]?.[0] ?? "", areas[goal.area]?.[1] ?? "") : goal.area} · `
                          : ""}
                        {source
                          ? `${t(source[0], source[1])} · ${origin?.[2]}-${origin?.[3]}-${origin?.[4]}`
                          : t("来自 me/goals.json", "From me/goals.json")}
                        {goal.due ? t(` · ${goal.due} 回看`, ` · review on ${goal.due}`) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={css.small}>{t("还没有目标", "No goals yet")}</p>
            )}
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("事实", "Facts")}</h2>
            {facts.length ? (
              <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>{facts.map(fact)}</div>
            ) : (
              <p className={css.small}>{t("还没有保存的事实", "No facts saved yet")}</p>
            )}
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("偏好和规则", "Preferences and rules")}</h2>
            <div className={`${css.card} ${css["list-card"]} ${css.facts}`}>
              {preferences.map(fact)}
              {ruleRows(data.rules, t)
                .filter(([, value]) => !!value)
                .map(([label, value]) => (
                  <div className={css.fact} key={label}>
                    <p>
                      {label} · {value}
                    </p>
                    <span className={css.src}>
                      {t("来自 作息与规则 · me/rules.md", "From routines and rules · me/rules.md")}
                    </span>
                    <span className={css["fact-acts"]}>
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        onClick={() =>
                          onPrompt(
                            t(
                              `请读取 me/rules.md，和我修改${label}的规则，等我确认再保存。`,
                              `Read me/rules.md and help me update the ${label} rule, confirming with me before saving.`,
                            ),
                          )
                        }
                      >
                        {t("修改", "Edit")}
                      </button>
                    </span>
                  </div>
                ))}
            </div>
          </section>
          {other.length > 0 && (
            <details>
              <summary className={css.link}>
                {t(`其他记忆 · ${other.length} 条`, `Other memories · ${other.length}`)}
              </summary>
              {other.map(fact)}
            </details>
          )}
          {!!data.archivedMemories?.length && (
            <details>
              <summary className={css.link}>
                {t(
                  `已归档 · ${data.archivedMemories.length} 条`,
                  `Archived · ${data.archivedMemories.length}`,
                )}
              </summary>
              {data.archivedMemories.map(fact)}
            </details>
          )}
          {!!data.memoryReplacements?.length && (
            <section className={css.sec}>
              <h2 className={css.eyebrow}>
                {t("待你确认的记忆替换", "Memory replacements for your review")}
              </h2>
              {data.memoryReplacements.map(({ file, candidate }) => (
                <div
                  className={css.card}
                  key={`${file}:${candidate.type}:${candidate.name}:${candidate.text}`}
                >
                  <p>{data.memories.find((item) => item.file === file)?.text}</p>
                  <p>
                    {t("建议改为：", "Suggested wording: ")}
                    {candidate.text}
                  </p>
                  <button
                    type="button"
                    className={css.btn}
                    disabled={busy}
                    onClick={() => {
                      const old = data.memories.find((item) => item.file === file);
                      if (old) void mutateMemory(() => replaceMemory(file, candidate, expectedMemory(old)));
                    }}
                  >
                    {t("确认替换", "Confirm replacement")}
                  </button>
                </div>
              ))}
            </section>
          )}
          <button
            type="button"
            className={css.link}
            onClick={() =>
              onPrompt(
                t(
                  "请读取 me/profile.md，和我更新名字和简介，确认后保存。",
                  "Read me/profile.md and help me update my name and bio, confirming before saving.",
                ),
              )
            }
          >
            {t("编辑名字和简介", "Edit name and bio")}
          </button>
        </>
      )}
    </div>
  );
}
