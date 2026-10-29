import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DoingProject,
  InboxEntry,
  LibraryData,
  OverviewData,
  OverviewMetric,
  OverviewNext,
} from "../types.js";
import css from "./Prototype.module.css";
import todayCss from "./TodayPage.module.css";
import { useLocale, useT } from "./i18n.js";
import {
  nextPresentation,
  todayDate,
  todayNumber,
  todayProjectDate,
  todayProjectFacts,
  todaySourceGroups,
} from "./next-presentation.js";

export function LifeHome({
  home,
  save,
  data,
  firstVisit,
  capture,
  writing,
  start,
  library,
  handover,
  memory,
  busy,
  ask,
  canAsk,
  askError,
  saveStatus,
  askText,
  setAskText,
  speech,
  insertSpeech,
  loadAtlas,
  openAtlas,
  weather,
  adopt,
  dismiss,
  loadLibrary,
  loadProjects,
  openProject,
  openGoal,
  begin,
}: {
  save?: (text: string) => void;
  home?: import("@kaitu/core").HomeState | null;
  loadProjects: () => Promise<DoingProject[]>;
  openProject: (slug: string) => void;
  openGoal?: (id: string) => void;
  begin?: () => void;
  data: OverviewData;
  firstVisit: boolean;
  capture: ReactNode;
  writing: boolean;
  start: () => void;
  library: () => void;
  handover: () => void;
  memory: () => void;
  busy: boolean;
  ask: (text: string) => void;
  canAsk: boolean;
  askError: string;
  saveStatus?: string;
  askText: string;
  setAskText: (text: string) => void;
  speech?: (
    action: "status" | "start" | "stop" | "cancel",
    locale?: string,
  ) => Promise<{ available: boolean; state: string; text: string }>;
  insertSpeech: (text: string) => void;
  loadAtlas?: () => Promise<import("@kaitu/core").LifeAtlasState>;
  openAtlas: () => void;
  weather?: ReactNode;
  adopt: (id: string) => void;
  dismiss: (id: string) => void;
  loadLibrary: (query: { section: "inbox"; source: string; before?: string }) => Promise<LibraryData>;
}) {
  const t = useT();
  const locale = useLocale();
  const [voice, setVoice] = useState<{ available: boolean; state: string; text: string }>({
    available: false,
    state: "idle",
    text: "",
  });
  const [voiceMessage, setVoiceMessage] = useState("");
  const voiceActive = useRef(false);
  const voiceEpoch = useRef(0);
  useEffect(() => {
    if (!speech) return;
    let live = true;
    void speech("status")
      .then((value) => {
        if (live) setVoice(value);
      })
      .catch(() => {});
    return () => {
      live = false;
      voiceEpoch.current++;
      if (voiceActive.current) void speech("cancel");
    };
  }, [speech]);
  const applyVoice = useCallback(
    (value: { available: boolean; state: string; text: string }) => {
      if (!voiceActive.current) return;
      setVoice(value);
      if (voiceActive.current && !["starting", "recording", "stopping"].includes(value.state)) {
        voiceActive.current = false;
        if ((value.state === "done" || value.state === "timeout") && value.text) insertSpeech(value.text);
        setVoiceMessage(
          value.state === "denied"
            ? t("未获得麦克风或语音识别权限。", "Microphone or speech permission denied.")
            : value.state === "unavailable"
              ? t("本机语音识别不可用。", "On-device speech recognition is unavailable.")
              : value.state === "timeout"
                ? t("录音已超时结束，请检查文字。", "Recording timed out; review the text.")
                : value.state === "error"
                  ? t("语音识别失败，请重试。", "Speech recognition failed; try again.")
                  : value.state === "done" && !value.text
                    ? t("没有识别到语音。", "No speech was recognized.")
                    : "",
        );
      }
    },
    [insertSpeech, t],
  );
  useEffect(() => {
    if (!speech || !["starting", "recording", "stopping"].includes(voice.state)) return;
    const epoch = voiceEpoch.current;
    const timer = setInterval(() => {
      void speech("status")
        .then((value) => {
          if (epoch === voiceEpoch.current) applyVoice(value);
        })
        .catch(() => {
          if (epoch === voiceEpoch.current)
            setVoiceMessage(t("语音识别连接失败。", "Speech connection failed."));
        });
    }, 500);
    return () => clearInterval(timer);
  }, [speech, voice.state, applyVoice, t]);
  const [projects, setProjects] = useState<{ cutoff: string; items: DoingProject[] } | null>(null);
  useEffect(() => {
    let active = true;
    if (home) return;
    void loadProjects()
      .then((items) => {
        if (active) setProjects({ cutoff: data.cutoff, items });
      })
      .catch(() => {
        if (active) setProjects(null);
      });
    return () => {
      active = false;
    };
  }, [loadProjects, data.cutoff, home]);
  const projectFacts = useMemo(
    () => todayProjectFacts(projects?.cutoff === data.cutoff ? projects.items : [], data.today, locale),
    [projects, data.cutoff, data.today, locale],
  );
  const sourceRegion = useRef<HTMLElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const [factSource, setFactSource] = useState<OverviewMetric | null>(null);
  useEffect(() => {
    if (factSource) sourceRegion.current?.focus();
  }, [factSource]);
  const closeSource = () => {
    setFactSource(null);
    requestAnimationFrame(() => sourceTrigger.current?.focus());
  };
  const [selectedThread, setSelectedThread] = useState(0);
  const [atlasData, setAtlasData] = useState<import("@kaitu/core").LifeAtlasState | null>(null);
  const [atlasImage, setAtlasImage] = useState<string | null>(null);
  const [atlasStatus, setAtlasStatus] = useState<"loading" | "ready" | "error">("loading");
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace notifications refresh the adopted map preview.
  useEffect(() => {
    if (!loadAtlas) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void loadAtlas()
        .then((atlas) => {
          if (active) {
            setAtlasData(atlas);
            setAtlasImage(atlas.resource?.svg ?? null);
            setAtlasStatus(atlas.loading ? "loading" : "ready");
            if (atlas.loading) retry = setTimeout(load, 150);
          }
        })
        .catch(() => {
          if (active) setAtlasStatus("error");
        });
    };
    load();
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [loadAtlas, data.cutoff]);
  const [todayNotes, setTodayNotes] = useState<{ day: string; cutoff: string; entries: InboxEntry[] } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    if (home) return;
    void (async () => {
      const entries: InboxEntry[] = [];
      let before: string | undefined;
      do {
        const page = await loadLibrary({ section: "inbox", source: "me", before });
        entries.push(...page.inbox.filter((entry) => entry.date?.startsWith(data.today)));
        if (page.inbox.some((entry) => (entry.date ?? "") < data.today) || !page.next) break;
        before = page.next;
      } while (active);
      if (active) setTodayNotes({ day: data.today, cutoff: data.cutoff, entries });
    })().catch(() => {
      if (active) setTodayNotes(null);
    });
    return () => {
      active = false;
    };
  }, [data.today, data.cutoff, loadLibrary, home]);
  const facts = useMemo(
    () =>
      data.metrics
        .filter(
          (metric) =>
            metric.value !== null &&
            metric.from &&
            metric.to &&
            ["workouts", "sleep", "protein", "weight"].includes(metric.key) &&
            todaySourceGroups(metric, data.timeZone, locale).length,
        )
        .slice(0, 3),
    [data.metrics, data.timeZone, locale],
  );
  const sourceGroups = useMemo(
    () => (factSource ? todaySourceGroups(factSource, data.timeZone, locale) : []),
    [factSource, data.timeZone, locale],
  );
  const paragraphs = new Map<string, OverviewMetric[]>();
  for (const metric of facts) {
    const key = `${metric.from}:${metric.to}`;
    paragraphs.set(key, [...(paragraphs.get(key) ?? []), metric]);
  }
  const openFact = (event: import("react").MouseEvent<HTMLButtonElement>, metric: OverviewMetric) => {
    sourceTrigger.current = event.currentTarget;
    setFactSource(metric);
  };
  const valueText = (metric: OverviewMetric) =>
    `${metric.estimated ? t("约", "about ") : ""}${metric.value === null ? "—" : todayNumber(metric.value, locale, metric.key === "protein" && metric.estimated ? 0 : 1)}${metric.key === "workouts" ? t(" 次", " workouts") : metric.key === "sleep" ? t(" 小时", " hours") : metric.key === "protein" ? t(" 克", " g") : ` ${metric.unit}`}`;
  return (
    <section
      className={`${todayCss.mirrorHome} ${home ? todayCss.savepointHome : ""}`}
      aria-label={t("今天", "Today")}
    >
      <header className={todayCss.homeHeading}>
        <div className={todayCss.dateWeather}>
          <p className={css.eyebrow}>{todayDate(data.today, locale)}</p>
          {weather && <div className={todayCss.weatherSlot}>{weather}</div>}
        </div>
        {!home && !firstVisit && (
          <button
            id="life-handover-start"
            type="button"
            className={`${css.btn} ${data.proposedTasks.length ? "" : css["btn-strong"]}`}
            onClick={handover}
          >
            {t("带去别的 AI 聊", "Take this to another AI")}
          </button>
        )}
        {!home && firstVisit && (
          <h1>{t("开图还不认识你。先从一件事说起。", "Let's start with one thing about you.")}</h1>
        )}
      </header>
      {loadAtlas && (
        <div className={todayCss.atlasPreview}>
          <button type="button" className={css.link} onClick={openAtlas}>
            {t("人生地图", "Life map")}
          </button>
          {atlasImage && atlasData?.resource ? (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${atlasData.resource.width} ${atlasData.resource.height}`}
            >
              <title>{t("人生地图", "Life map")}</title>
              <image
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(atlasImage)}`}
                width={atlasData.resource.width}
                height={atlasData.resource.height}
              />
              {home?.data?.threads.map((thread, index) => {
                const domain = atlasData.domains.find((d) =>
                  d.facts.some(
                    (f) => f.source === thread.file && (thread.kind !== "goal" || f.id === thread.id),
                  ),
                );
                const point = domain && atlasData.resource?.regions.provinces[domain.slot];
                if (!point) return null;
                return (
                  // biome-ignore lint/a11y/useValidAnchor: SVG link selects the linked save point below.
                  <a
                    key={thread.key}
                    href="#home-savepoint"
                    tabIndex={0}
                    aria-label={thread.title}
                    onClick={(event) => {
                      event.preventDefault();
                      setSelectedThread(index);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedThread(index);
                      }
                    }}
                  >
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={index === selectedThread ? 22 : 14}
                      fill={index === selectedThread ? "#d9902f" : "#2b4c7e"}
                      stroke="#fffdf8"
                      strokeWidth="4"
                    />
                    <title>{thread.title}</title>
                  </a>
                );
              })}
            </svg>
          ) : (
            <small>
              {atlasStatus === "loading"
                ? t("正在读取地图…", "Loading map…")
                : atlasStatus === "error"
                  ? t("地图暂时无法读取 · 去开图查看", "Map unavailable · Open Explore")
                  : t("还没有人生地图 · 去开图查看", "No life map yet · Open Explore")}
            </small>
          )}
        </div>
      )}
      {home && (
        <Savepoint
          selected={selectedThread}
          select={setSelectedThread}
          data={home}
          openProject={openProject}
          openGoal={openGoal}
          begin={firstVisit ? begin : undefined}
          library={library}
          adopt={adopt}
          dismiss={dismiss}
        />
      )}
      {canAsk && (
        <form
          className={todayCss.askHome}
          onSubmit={(event) => {
            event.preventDefault();
            if (askText.trim()) ask(askText);
          }}
        >
          <label htmlFor="today-ask">{t("此刻，想聊什么？", "What’s on your mind?")}</label>
          <div className={todayCss.composer}>
            <textarea
              id="today-ask"
              value={askText}
              onChange={(event) => setAskText(event.target.value)}
              placeholder={t("此刻想到的…", "Something on your mind…")}
            />
            <div className={todayCss.composerTools}>
              {voice.available && speech && (
                <div className={todayCss.voiceTools}>
                  {!["starting", "recording", "stopping"].includes(voice.state) ? (
                    <button
                      type="button"
                      className={todayCss.voiceButton}
                      onClick={() => {
                        setVoiceMessage("");
                        const epoch = ++voiceEpoch.current;
                        voiceActive.current = true;
                        void speech("start", locale)
                          .then((value) => {
                            if (epoch === voiceEpoch.current) applyVoice(value);
                          })
                          .catch(() => {
                            if (epoch !== voiceEpoch.current) return;
                            voiceActive.current = false;
                            setVoiceMessage(t("无法启动语音。", "Could not start speech."));
                          });
                      }}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        aria-hidden="true"
                      >
                        <rect x="9" y="3" width="6" height="12" rx="3" />
                        <path d="M6 11v2a6 6 0 0 0 12 0v-2M12 19v3M8 22h8" />
                      </svg>
                      <span className={css.sr}>{t("说一段", "Speak")}</span>
                    </button>
                  ) : (
                    <>
                      <output>
                        {voice.state === "recording"
                          ? t("正在听…", "Listening…")
                          : t("正在处理…", "Working…")}
                      </output>
                      {voice.state === "recording" && (
                        <button
                          type="button"
                          className={css.btn}
                          onClick={() => {
                            const epoch = voiceEpoch.current;
                            void speech("stop").then((value) => {
                              if (epoch === voiceEpoch.current) applyVoice(value);
                            });
                          }}
                        >
                          {t("完成", "Done")}
                        </button>
                      )}
                      <button
                        type="button"
                        className={css.link}
                        onClick={() => {
                          const epoch = ++voiceEpoch.current;
                          voiceActive.current = false;
                          void speech("cancel").then((value) => {
                            if (epoch === voiceEpoch.current) setVoice(value);
                          });
                        }}
                      >
                        {t("取消", "Cancel")}
                      </button>
                    </>
                  )}
                </div>
              )}
              {voiceMessage && <output>{voiceMessage}</output>}
              <output
                aria-live="polite"
                aria-atomic="true"
                className={saveStatus ? todayCss.saveStatus : css.sr}
              >
                {saveStatus}
              </output>
              {save && (
                <button
                  type="button"
                  className={css.btn}
                  disabled={!askText.trim()}
                  onClick={() => save(askText)}
                >
                  {t("记下", "Save")}
                </button>
              )}
              <button className={`${css.btn} ${css["btn-strong"]}`} type="submit" disabled={!askText.trim()}>
                {t("去问问 →", "Ask →")}
              </button>
            </div>
          </div>
          {askError && <p role="alert">{askError}</p>}
        </form>
      )}
      {!home && !firstVisit && facts.length > 0 && (
        <div className={todayCss.mirror}>
          {[...paragraphs.values()].map((metrics) => {
            const first = metrics[0];
            const recentWeek =
              first?.to === data.today &&
              Date.parse(`${first.to}T12:00:00Z`) - Date.parse(`${first.from}T12:00:00Z`) === 6 * 86400000;
            return (
              <p key={`${first?.from}:${first?.to}`}>
                {recentWeek
                  ? t("近七天，", "In the past seven days, ")
                  : first?.from === first?.to && first?.from
                    ? `${todayDate(first.from, locale, true)}，`
                    : t("最近，", "Recently, ")}
                {metrics.map((metric, i) => (
                  <span key={metric.key}>
                    {metric.key === "workouts"
                      ? t("训练了", "you logged ")
                      : metric.key === "sleep"
                        ? t("睡眠平均", "sleep averaged ")
                        : metric.key === "protein"
                          ? t("蛋白质日均", "daily protein averaged ")
                          : t("记录的体重为", "your recorded weight was ")}
                    <button
                      type="button"
                      className={todayCss.factLink}
                      aria-label={t(
                        `${metric.label} ${valueText(metric)}，查看来源`,
                        `${metric.label} ${valueText(metric)}, view sources`,
                      )}
                      onClick={(event) => openFact(event, metric)}
                    >
                      {valueText(metric)}
                    </button>
                    {i < metrics.length - 1 ? t("，", ", ") : t("。", ".")}
                  </span>
                ))}
              </p>
            );
          })}
        </div>
      )}
      {!home &&
        !firstVisit &&
        projectFacts.map((project) => (
          <p className={todayCss.projectFact} key={project.slug}>
            {t(
              `「${nextPresentation({ title: project.title }, locale).title}」`,
              `“${project.title}” made progress `,
            )}
            <button
              type="button"
              className={todayCss.factLink}
              onClick={() => openProject(project.slug)}
              aria-label={t(
                `${project.title} ${project.recentLog.date}，查看项目进展原文`,
                `${project.title}, ${project.recentLog.date}, view project log`,
              )}
            >
              {todayProjectDate(project.recentLog.date, data.today, locale)}
            </button>
            {t("有进展：", ": ")}
            {nextPresentation({ title: project.recentLog.text }, locale).title}
          </p>
        ))}
      {!home && !!data.proposedTasks.length && (
        <section className={todayCss.aiSuggestions}>
          <h2>{t("AI 留的建议", "Suggestions from AI")}</h2>
          {data.proposedTasks.map((item) => (
            <div className={css.row} key={item.id}>
              <span>{item.title}</span>
              <button type="button" className={css.link} disabled={busy} onClick={() => adopt(item.id)}>
                {t("确认", "Confirm")}
              </button>
              <button type="button" className={css.link} disabled={busy} onClick={() => dismiss(item.id)}>
                {t("不用", "Dismiss")}
              </button>
            </div>
          ))}
        </section>
      )}
      {factSource && (
        <section
          ref={sourceRegion}
          tabIndex={-1}
          className={todayCss.sourceRecord}
          aria-label={t("来源记录", "Source record")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSource();
            }
          }}
        >
          <h2>{t("来源记录", "Source record")}</h2>
          <p>
            {factSource.from} — {factSource.to}
          </p>
          {["sleep", "protein"].includes(factSource.key) && (
            <p>
              {t(
                `按有记录的 ${factSource.days} ${factSource.key === "sleep" ? "晚" : "天"}计算${factSource.estimated ? "，含估算值" : ""}`,
                `Average over ${factSource.days} recorded ${factSource.key === "sleep" ? "nights" : "days"}${factSource.estimated ? ", including estimates" : ""}`,
              )}
            </p>
          )}
          {factSource.key === "workouts" && (
            <p>
              {t(
                `${factSource.value} 次训练 · ${factSource.sources.length} 条动作记录`,
                `${factSource.value} workouts · ${factSource.sources.length} exercise records`,
              )}
            </p>
          )}
          {sourceGroups.map((group) => (
            <details key={group.label} open>
              <summary>{group.label}</summary>
              <ul>
                {group.rows.map((row) => (
                  <li key={String(row.id)}>
                    {factSource.key === "workouts"
                      ? `${String(row.exercise)}${typeof row.sets === "number" ? t(` · ${row.sets} 组`, ` · ${row.sets} sets`) : ""}${typeof row.reps === "number" ? t(` × ${row.reps} 次`, ` × ${row.reps} reps`) : ""}${typeof row.weight_kg === "number" ? t(` · ${row.weight_kg} 公斤`, ` · ${row.weight_kg} kg`) : ""}`
                      : factSource.key === "sleep"
                        ? t(
                            `睡眠 ${Number((Number(row.duration_min) / 60).toFixed(1))} 小时`,
                            `Sleep: ${Number((Number(row.duration_min) / 60).toFixed(1))} hours`,
                          )
                        : factSource.key === "protein"
                          ? `${String(row.meal ?? "")} · ${Number(row.uncertainty) > 0 ? t("约 ", "about ") : ""}${String(row.protein_g)} ${t("克蛋白质", "g protein")}`
                          : `${String(row.value)} ${String(row.unit)}`}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <button type="button" className={css.link} onClick={closeSource}>
            {t("收起来源", "Close source")}
          </button>
        </section>
      )}
      {!home && (
        <footer className={todayCss.homeLinks}>
          <button id="life-capture-start" type="button" className={css.link} onClick={start}>
            {t("随手记一句", "Keep a quick note")}
          </button>
          <button type="button" className={css.link} onClick={library}>
            {todayNotes?.day === data.today
              ? t(
                  `今天记了 ${todayNotes.entries.length} 条 · 在资料里`,
                  `${todayNotes.entries.length} notes today · Library`,
                )
              : t("在资料里回看", "Read in Library")}
          </button>
          {firstVisit ? (
            <button type="button" className={css.link} onClick={memory}>
              {t("搬入 AI 记忆、对话或资料", "Bring AI memories, conversations or files")}
            </button>
          ) : null}
        </footer>
      )}
      {writing && capture}
    </section>
  );
}

function Savepoint({
  selected,
  select,
  data,
  openProject,
  openGoal,
  begin,
  library,
  adopt,
  dismiss,
}: {
  selected: number;
  select: (index: number) => void;
  data: import("@kaitu/core").HomeState;
  openProject: (slug: string) => void;
  openGoal?: (id: string) => void;
  begin?: () => void;
  library: () => void;
  adopt: (id: string) => void;
  dismiss: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();

  const threads = data.data?.threads ?? [];
  const thread = threads[Math.min(selected, Math.max(0, threads.length - 1))];
  return (
    <div className={todayCss.savepointGrid}>
      <section id="home-savepoint" className={todayCss.continueSection}>
        <div className={todayCss.sectionHeading}>
          <h2>{t("接着上次", "Pick up where you left off")}</h2>
          <button type="button" className={css.link} onClick={library}>
            {t("查看全部", "View all")}
          </button>
        </div>
        {thread ? (
          [thread, ...threads.filter((item) => item.key !== thread.key)].slice(0, 2).map((item) => (
            <article key={item.key} className={todayCss.continueCard} data-selected={item.key === thread.key}>
              <span className={todayCss.projectSymbol} data-kind={item.kind} aria-hidden="true">
                {item.kind === "learning" ? "▤" : item.kind === "goal" ? "◎" : "▧"}
              </span>
              <button
                type="button"
                className={todayCss.projectChoice}
                onClick={() => select(threads.indexOf(item))}
              >
                <h3 title={item.title}>{item.title}</h3>
                {(item.last || item.next) && (
                  <p title={item.last?.text ?? item.next?.title}>
                    {item.last ? t("上次：", "Last: ") : t("下一步：", "Next: ")}
                    {item.last?.text ?? item.next?.title}
                  </p>
                )}
              </button>
              <button
                type="button"
                className={css.btn}
                aria-label={t(`打开${item.title}`, `Open ${item.title}`)}
                onClick={() =>
                  item.kind === "project"
                    ? openProject(item.id)
                    : item.kind === "goal" && openGoal
                      ? openGoal(item.id)
                      : library()
                }
              >
                →
              </button>
            </article>
          ))
        ) : (
          <div className={todayCss.continueCard}>
            <p>{data.loading ? t("正在读取…", "Loading…") : t("还没有项目", "No projects yet")}</p>
            <button type="button" className={css.btn} onClick={begin ?? library}>
              {begin ? t("开始", "Get started") : t("打开资料", "Open Library")}
            </button>
          </div>
        )}
        {data.error && <p role="alert">{data.error}</p>}
      </section>
      <aside className={todayCss.savepointSide}>
        <section className={todayCss.savepointCard}>
          <h3>{t("最近的痕迹", "Recent traces")}</h3>
          {data.data?.traces.length ? (
            <ol className={todayCss.traceList}>
              {data.data.traces.slice(0, 3).map((trace) => (
                <li key={trace.key}>
                  <span title={trace.label}>
                    {trace.label}
                    {trace.value !== null
                      ? ` ${trace.estimated ? "≈" : ""}${todayNumber(trace.value, locale)} ${trace.unit ?? ""}`
                      : ""}
                  </span>
                  <time dateTime={trace.date} title={trace.date}>
                    {todayProjectDate(trace.date, data.data?.today ?? trace.date, locale)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("还没有近期痕迹", "No recent traces")}</p>
          )}
        </section>
        {!!data.data?.pending.length && (
          <section className={todayCss.savepointCard}>
            <h3>{t("待确认", "Pending")}</h3>
            {data.data.pending.slice(0, 2).map((item) => (
              <div key={item.id}>
                <p>{item.title}</p>
                <button type="button" className={css.btn} onClick={() => adopt(item.id)}>
                  {t("采纳", "Adopt")}
                </button>
                <button type="button" className={css.link} onClick={() => dismiss(item.id)}>
                  {t("略过", "Dismiss")}
                </button>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}

export function TodayStart({
  start,
  memory,
  connect,
  storage,
  workspaceRoot,
  status,
  busy = false,
}: {
  start: (text: string) => void;
  memory: () => void;
  connect: () => void;
  storage?: () => void;
  workspaceRoot?: string;
  status: import("@kaitu/core").OnboardingStatus | null;
  busy?: boolean;
}) {
  const t = useT();
  const [goal, setGoal] = useState("");
  const stepDone = (id: string) =>
    id === "matter"
      ? !!(status?.draft || status?.next || status?.checklist.items.find((item) => item.id === id)?.done)
      : !!status?.checklist.items.find((item) => item.id === id)?.done;
  const steps = [
    ["matter", t("写下一件事", "Write down one thing"), () => start(goal)],
    ["memory", t("把 AI 记得的你搬过来", "Bring over what AI remembers"), memory],
    ["ai", t("接上 AI（可以先跳过）", "Connect AI (optional)"), connect],
  ] as const;
  return (
    <>
      <section className={todayCss.start}>
        <p className={css.eyebrow}>{t("欢迎来到开图", "Welcome to Kaitu")}</p>
        <h1>{t("从一件事开始。", "Start with one thing.")}</h1>
        <label htmlFor="onboarding-goal">{t("最想做成的一件事", "One thing to do")}</label>
        <form
          className={todayCss.goalForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) start(goal.trim());
          }}
        >
          <input
            id="onboarding-goal"
            className={css.input}
            aria-label={t("最想做成的一件事", "One thing to do")}
            placeholder={t("比如：两年内出版第一本散文集", "For example: publish my first essay collection")}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <button type="submit" className={`${css.btn} ${css["btn-strong"]}`} disabled={busy || !goal.trim()}>
            {t("就是它", "That's it")}
          </button>
        </form>
        <div className={todayCss.topics}>
          {(
            [
              ["工作", "work"],
              ["身体", "body"],
              ["学习", "learning"],
              ["关系", "relationships"],
              ["生活", "life"],
            ] as const
          ).map(([zh, en]) => (
            <button
              type="button"
              className={css.btn}
              key={en}
              onClick={() => start(t(`我想理一理${zh}：`, `I'd like to think about ${en}: `))}
            >
              {t(zh, en)}
            </button>
          ))}
          <button type="button" className={css.link} onClick={() => start("")}>
            {t("还没想好，我想直接说一段", "Not sure yet; start with a thought")}
          </button>
        </div>
      </section>
      {!steps.every(([id]) => stepDone(id)) && (
        <section className={todayCss.steps}>
          <h2>{t("三步用起来", "Three steps to get started")}</h2>
          {steps.map(([id, title, action], i) => (
            <div className={css.row} key={id}>
              <span aria-label={stepDone(id) ? t("已完成", "Done") : undefined}>
                {stepDone(id) ? "✓" : i + 1}
              </span>
              <span className={todayCss.grow}>
                <b>{title}</b>
              </span>
              {i > 0 && (
                <button type="button" className={css.btn} onClick={action}>
                  {i === 1 ? t("搬过来", "Bring it over") : t("看看怎么接", "See how")}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {storage && (
        <section className={todayCss.storage}>
          <h2>
            {workspaceRoot
              ?.replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .at(-1) ?? t("资料", "Data")}
          </h2>
          <p className={todayCss.storagePath}>{workspaceRoot ?? t("正在读取…", "Loading…")}</p>
          <button type="button" className={css.link} onClick={storage}>
            {t("换个位置", "Change location")}
          </button>
        </section>
      )}
    </>
  );
}

/** Only clipped goals become interactive; the full text remains unchanged. */
export function TodayGoal({ text, title = false }: { text: string; title?: boolean }) {
  const t = useT();
  const line = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    setOpen(false);
    const measure = () => {
      const node = line.current;
      if (node)
        setClipped(!!text && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (line.current) observer.observe(line.current);
    return () => observer.disconnect();
  }, [text]);
  const Text = title ? "b" : "span";
  return (
    <div className={`${todayCss.goal} ${title ? todayCss.goalTitle : ""}`}>
      {!title && <span>{t("为了", "For")}</span>}
      <Text ref={line} className={todayCss.goalLine}>
        {text}
      </Text>
      {clipped && (
        <button type="button" className={css.link} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("收起", "Show less") : t("展开", "Show more")}
        </button>
      )}
      {open && clipped && <p>{text.replace(/(?<=.)(?=[[【][^\]】]{1,16}[\]】])/g, "\n")}</p>}
    </div>
  );
}

export function TodayTasks({
  data,
  busy,
  complete,
  ask,
  schedule,
  review,
  focusCard,
  focusTaskId,
  all,
  adopted = [],
  showAll = false,
}: {
  data: OverviewData;
  busy: boolean;
  complete: (item: OverviewNext) => void;
  ask: (item: OverviewNext) => void;
  schedule: (item: OverviewNext) => void;
  review: () => void;
  focusCard?: ReactNode;
  focusTaskId?: string;
  all: () => void;
  adopted?: string[];
  showAll?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const focus = data.next[0];
  const focusText = focus && nextPresentation(focus, locale);
  const goal =
    data.plans.goals.find((goal) => goal.next?.id === focus?.id)?.title ??
    Object.values(data.plans.sources).find((source) => source.taskId === focus?.id)?.goalTitle;
  const upcoming = (focusCard ? data.allNext : data.allNext.slice(1))
    .filter((item) => item.id !== focusTaskId)
    .sort((a, b) => Number(adopted.includes(b.id)) - Number(adopted.includes(a.id)));
  const extra = (item: OverviewNext, inRow = true) => (
    <details className={todayCss.more}>
      <summary
        aria-label={t(
          `更多操作：${nextPresentation(item, locale).title}`,
          `More actions: ${nextPresentation(item, locale).title}`,
        )}
      >
        ···
      </summary>
      {!item.proposed && (
        <button type="button" className={css.link} onClick={() => schedule(item)}>
          {t("安排时间段", "Schedule a time")}
        </button>
      )}
      {inRow && item.proposed && item.id.startsWith("onboarding-matter-") && (
        <button type="button" className={css.link} onClick={review}>
          {t("去核对", "Review")}
        </button>
      )}
      {inRow && (
        <button type="button" className={css.link} onClick={() => ask(item)}>
          {t("交给 AI", "Ask AI")}
        </button>
      )}
    </details>
  );
  const row = (item: OverviewNext) => {
    const display = nextPresentation(item, locale);
    return (
      <div className={todayCss.nextRow} key={`${item.file}:${item.id}`}>
        <button
          type="button"
          className={css.check}
          disabled={busy || item.proposed}
          aria-label={t(`完成：${display.title}`, `Done: ${display.title}`)}
          onClick={() => complete(item)}
        >
          ✓
        </button>
        <span className={todayCss.nextTitle}>
          {display.title}
          {adopted.includes(item.id) && <small>{t("刚采纳", "Just added")}</small>}
          {item.proposed && <small>{t(" · 建议", " · Suggested")}</small>}
        </span>
        <span className={css.small}>
          {data.blocks.find((block) => block.ref === item.id)?.start?.slice(11, 16)}
        </span>
        {extra(item)}
      </div>
    );
  };
  return (
    <>
      {!showAll && (focus || focusCard) && (
        <section className={todayCss.focusSection}>
          {focusCard ??
            (focus && (
              <>
                <h2 className={css.eyebrow}>{t("现在这件事", "One thing now")}</h2>
                <div className={todayCss.focus}>
                  <h2>{focusText?.title}</h2>
                  {goal && <TodayGoal text={goal} />}
                  <div className={todayCss.actions}>
                    {!focus.proposed && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-strong"]}`}
                        disabled={busy}
                        onClick={() => complete(focus)}
                      >
                        {t("完成", "Done")}
                      </button>
                    )}
                    {focus.proposed && focus.id.startsWith("onboarding-matter-") && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-strong"]}`}
                        disabled={busy}
                        onClick={review}
                      >
                        {t("去核对", "Review")}
                      </button>
                    )}
                    <button type="button" className={css.btn} onClick={() => ask(focus)}>
                      {t("交给 AI", "Ask AI")}
                    </button>
                    {!focus.proposed && (
                      <button type="button" className={css.btn} onClick={() => schedule(focus)}>
                        {t("安排时间", "Schedule a time")}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ))}
        </section>
      )}
      {upcoming.length > 0 && (
        <section className={todayCss.upcoming}>
          <div className={todayCss.sectionHead}>
            <h2>{t("接下来", "Up next")}</h2>
            {!showAll && (
              <button type="button" className={css.link} onClick={all}>
                {t(`全部 ${upcoming.length} 条`, `All ${upcoming.length}`)}
              </button>
            )}
          </div>
          <div>{(showAll ? upcoming : upcoming.slice(0, 3)).map(row)}</div>
        </section>
      )}
    </>
  );
}
