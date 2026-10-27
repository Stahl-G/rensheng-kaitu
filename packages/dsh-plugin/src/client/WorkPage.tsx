import { useCallback, useEffect, useRef, useState } from "react";
import type { Experience, MeData } from "../types.js";
import type { DoingPageProps } from "./DoingPage.js";
import { ExperienceEditor } from "./ExperienceEditor.js";
import { ExperienceImportControls } from "./ExperienceImportControls.js";
import { JobsPage, type JobsPageProps } from "./JobsPage.js";
import type { MapPageProps } from "./MapPage.js";
import { downloadResume } from "./MePage.js";
import { ResumeImport, type ResumeServices } from "./ResumeImport.js";
import { SourceEvidence } from "./SourceEvidence.js";
import css from "./WorkPage.module.css";
import { useT } from "./i18n.js";

export interface WorkPageProps
  extends JobsPageProps,
    Partial<ResumeServices>,
    Pick<DoingPageProps, "loadProjects">,
    Pick<
      MapPageProps,
      | "loadLifeMap"
      | "loadExperienceSource"
      | "editExperience"
      | "loadExperienceImports"
      | "previewExperienceBatch"
      | "setExperienceSource"
      | "changeExperienceBatch"
      | "recoverExperienceImports"
    > {
  loadMe: () => Promise<MeData>;
  openProjects: (slug?: string) => void;
  onPrompt: (text: string) => void;
}

/** A projection of the existing career, projects and job sources. No separate career store. */
export function WorkPage(props: WorkPageProps) {
  const t = useT();
  const [profile, setProfile] = useState<MeData | null>(null);
  const [items, setItems] = useState<Experience[]>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<DoingPageProps["loadProjects"]>>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Experience | null>(null);
  const [focus, setFocus] = useState<"work" | "jobs">("work");
  const [limit, setLimit] = useState(10);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const attempt = ++sequence.current;
    const results = await Promise.allSettled([props.loadMe(), props.loadLifeMap(), props.loadProjects()]);
    if (attempt !== sequence.current) return;
    const [me, map, work] = results;
    if (me.status === "fulfilled") setProfile(me.value);
    if (map.status === "fulfilled")
      setItems(
        map.value.experiences.filter(
          (item) => ["worked", "studied"].includes(item.event_type) && item.fact_status !== "planned",
        ),
      );
    if (work.status === "fulfilled") setProjects(work.value.filter((item) => item.kind === "work"));
    setErrors(
      results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
          : [],
      ),
    );
    setLoading(false);
  }, [props.loadMe, props.loadLifeMap, props.loadProjects]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  const facts = items.filter((item) => ["user_reported", "observed"].includes(item.fact_status));
  const pending = items.filter((item) => ["inferred", "suggested"].includes(item.fact_status));
  const current = facts.filter(
    (item) => item.event_type === "worked" && "current" in item && item.current === true && !item.end,
  );
  const career = (kind: "worked" | "studied") =>
    facts
      .filter((item) => item.event_type === kind)
      .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  const period = (item: Experience) =>
    [
      item.start || t("开始时间未知", "Start date unknown"),
      item.end ||
        ("current" in item && item.current === true
          ? t("至今", "Present")
          : t("结束时间未记录", "End date not recorded")),
    ].join(" – ");
  const entry = (item: Experience) => (
    <li key={item.id}>
      <div className={css.entryHead}>
        <h3>{item.title || item.place.name}</h3>
        <button type="button" onClick={() => setEditor(item)}>
          {t("修改", "Edit")}
        </button>
      </div>
      <p className={css.meta}>
        {period(item)} · {item.place.name}
      </p>
      {item.notes && <p className={css.notes}>{item.notes}</p>}
      <SourceEvidence id={item.id} load={props.loadExperienceSource} />
      {editor?.id === item.id && (
        <ExperienceEditor
          item={editor}
          cancel={() => setEditor(null)}
          save={async (changes) => {
            await props.editExperience(item.id, changes, item.rev ?? 1);
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </li>
  );
  const work = (
    <section className={css.card} aria-label={t("当前工作", "Current work")}>
      <div className={css.sectionHead}>
        <h2>{t("当前工作", "Current work")}</h2>
        <button type="button" onClick={() => props.openProjects()}>
          {t("全部项目", "All projects")} →
        </button>
      </div>
      {current.length > 0 ? (
        <ul className={css.timeline}>{current.map(entry)}</ul>
      ) : (
        <p className={css.meta}>
          {t(
            "尚未记录明确的在任状态，当前进展以工作项目为准。",
            "Current employment has not been explicitly recorded. Work projects show your current progress.",
          )}
        </p>
      )}
      {projects.length ? (
        <div className={css.projects}>
          {[...projects]
            .sort((a, b) => Number(b.stage === "active") - Number(a.stage === "active"))
            .slice(0, limit)
            .map((project) => (
              <article key={project.slug} className={css.project}>
                <div className={css.entryHead}>
                  <h3>
                    <button type="button" onClick={() => props.openProjects(project.slug)}>
                      {project.title} ↗
                    </button>
                  </h3>
                  <span className={css.tag}>
                    {t(
                      { active: "进行中", paused: "已暂停", idea: "想法", done: "已完成" }[project.stage],
                      { active: "Active", paused: "Paused", idea: "Idea", done: "Done" }[project.stage],
                    )}
                  </span>
                </div>
                {project.recentLog ? (
                  <>
                    <small>
                      {t("最近进展", "Latest update")} · {project.recentLog.date}
                    </small>
                    <p className={css.notes}>{project.recentLog.text}</p>
                  </>
                ) : (
                  <p className={css.meta}>{t("还没有结果记录", "No results recorded yet")}</p>
                )}
                {(project.blocked?.length ?? 0) > 0 && (
                  <p className={css.next}>
                    <span>{t("阻塞", "Blocked")}</span>
                    {project.blocked?.join(" · ")}
                  </p>
                )}
                {project.next
                  .filter((next) => next.status === "todo" || next.status === "proposed")
                  .slice(0, 3)
                  .map((next) => (
                    <p key={next.id} className={css.next}>
                      <span>
                        {next.status === "proposed" ? t("AI 建议", "AI suggestion") : t("下一步", "Next")}
                      </span>
                      {next.title}
                    </p>
                  ))}
              </article>
            ))}
        </div>
      ) : (
        <p>
          {t(
            "把正在推进的工作建成项目，成果、阻塞和下一步会出现在这里。",
            "Add a work project to see its results, blockers and next steps here.",
          )}
        </p>
      )}
      {projects.length > limit && (
        <button type="button" onClick={() => setLimit((count) => count + 10)}>
          {t("查看更多项目", "Show more projects")}
        </button>
      )}
    </section>
  );
  const jobs = (
    <section className={css.card} aria-label={t("求职", "Job search")}>
      <JobsPage {...props} embedded />
    </section>
  );
  return (
    <main className={css.page} aria-busy={loading}>
      <header className={css.profile}>
        <div className={css.cover} />
        <div className={css.profileBody}>
          {profile?.avatar ? (
            <img className={css.avatar} src={profile.avatar} alt="" />
          ) : (
            <span className={css.avatar} aria-hidden="true">
              {profile?.name?.slice(0, 1) || "◎"}
            </span>
          )}
          <div className={css.sectionHead}>
            <div>
              <p className={css.eyebrow}>{t("工作与求职", "Work and job search")}</p>
              <h1>{profile?.name || t("你的职业档案", "Your career profile")}</h1>
              <p>
                {current
                  .map((item) => item.title)
                  .filter(Boolean)
                  .join(" · ") ||
                  t("记录现在的工作，接着走下一步", "Keep track of your work and what comes next")}
              </p>
            </div>
            <button
              type="button"
              disabled={!profile?.career.length}
              onClick={() => profile && downloadResume(profile, t)}
            >
              {t("导出简历", "Export résumé")}
            </button>
          </div>
          <nav className={css.focus} aria-label={t("当前重点", "Current focus")}>
            <button type="button" aria-pressed={focus === "work"} onClick={() => setFocus("work")}>
              {t("工作在前", "Work first")}
            </button>
            <button type="button" aria-pressed={focus === "jobs"} onClick={() => setFocus("jobs")}>
              {t("求职在前", "Job search first")}
            </button>
            <a href="#career-resume">{t("简历与教育", "Résumé and education")}</a>
          </nav>
        </div>
      </header>
      {loading && <output>{t("正在读取职业资料…", "Loading career information…")}</output>}
      {errors.map((error) => (
        <p key={error} role="alert">
          {error}
        </p>
      ))}
      {errors.length > 0 && (
        <button type="button" onClick={() => void refresh()}>
          {t("重新读取", "Reload")}
        </button>
      )}
      <div className={css.columns}>
        <div className={css.main}>
          {focus === "work" ? (
            <>
              {work}
              {jobs}
            </>
          ) : (
            <>
              {jobs}
              {work}
            </>
          )}
          <section className={css.card}>
            <h2>{t("关于", "About")}</h2>
            <p className={css.notes}>
              {profile?.bio ||
                t(
                  "还没有职业简介。可以从个人档案补充关于自己的介绍。",
                  "No introduction yet. Add one in your profile.",
                )}
            </p>
          </section>
          <section id="career-resume" className={css.card}>
            <h2>{t("工作经历", "Experience")}</h2>
            {career("worked").length ? (
              <ol className={css.timeline}>{career("worked").slice(0, limit).map(entry)}</ol>
            ) : (
              <p>
                {t("导入自己的简历，或记录第一段工作经历。", "Import your résumé or record your first role.")}
              </p>
            )}
            {career("worked").length > limit && (
              <button type="button" onClick={() => setLimit((count) => count + 10)}>
                {t("查看更多经历", "Show more experience")}
              </button>
            )}
          </section>
          <section className={css.card}>
            <h2>{t("教育经历", "Education")}</h2>
            {career("studied").length ? (
              <ol className={css.timeline}>{career("studied").slice(0, limit).map(entry)}</ol>
            ) : (
              <p className={css.meta}>
                {t(
                  "还没有教育经历。学历保留在简历里。",
                  "No education recorded. Education belongs to your résumé.",
                )}
              </p>
            )}
            {career("studied").length > limit && (
              <button type="button" onClick={() => setLimit((count) => count + 10)}>
                {t("查看更多教育经历", "Show more education")}
              </button>
            )}
          </section>
          {pending.length > 0 && (
            <section className={css.card}>
              <h2>{t("待核对的经历", "Experience to review")}</h2>
              <p>
                {t(
                  "有歧义或 AI 推断，暂不作为履历事实或当前任职。",
                  "Ambiguous or inferred entries are kept separate from résumé facts and current roles.",
                )}
              </p>
              <ol className={css.timeline}>{pending.slice(0, limit).map(entry)}</ol>
              {pending.length > limit && (
                <button type="button" onClick={() => setLimit((count) => count + 10)}>
                  {t("查看更多待核对经历", "Show more entries to review")}
                </button>
              )}
            </section>
          )}
        </div>
        <aside className={css.aside}>
          {props.uploadResume && props.resumePrompt && props.importResume && props.resumeConnection && (
            <ResumeImport
              uploadResume={props.uploadResume}
              resumePrompt={props.resumePrompt}
              importResume={props.importResume}
              resumeConnection={props.resumeConnection}
              extractResume={props.extractResume}
              onChanged={refresh}
            />
          )}
          <section className={css.card}>
            <h2>{t("完善职业档案", "Build your career profile")}</h2>
            <p>
              {t(
                "工作和求职共用一份经历与教育。明确的本人事实自动记录，整次导入可撤销。",
                "Work and job search share one career history. Explicit personal facts are recorded automatically; imports can be undone.",
              )}
            </p>
            <button
              type="button"
              className={css.primary}
              onClick={() =>
                props.onPrompt(
                  t(
                    "请用 build-life-map 技能整理我明确提供的本人工作与教育经历，保留来源，不推断在职状态。",
                    "Use build-life-map to organize my explicitly stated work and education, preserving sources without guessing current employment.",
                  ),
                )
              }
            >
              {t("从已有资料整理", "Organize existing information")}
            </button>
          </section>
          <section className={css.card}>
            <ExperienceImportControls
              {...props}
              pending={0}
              reviewPending={pending.length}
              onChanged={refresh}
            />
          </section>
        </aside>
      </div>
    </main>
  );
}
