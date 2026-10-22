import type { JobSource, JobsData } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import css from "./JobsPage.module.css";
import { useT } from "./i18n.js";

export interface JobsPageProps {
  loadJobs: () => Promise<JobsData>;
  subscribe?: (refresh: () => void) => () => void;
}

function sourceLink(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function JobDetails({ item }: { item: JobSource }) {
  const t = useT();
  const link = sourceLink(item.url);
  const fields = [
    [t("公司", "Company"), item.company],
    [t("地点", "Location"), item.location],
    [t("来源", "Source"), item.source],
    [t("发现日期", "Date found"), item.date_found],
    [t("发布说明", "Publication note"), item.posted],
    [t("方向", "Track"), item.track],
    [t("薪资", "Salary"), item.salary],
    [t("来源状态（原文）", "Source status (original)"), item.status],
    [t("来源编号", "Source ID"), item.id],
  ];
  return (
    <details className={css.job}>
      <summary>
        <strong>{item.title || t("未命名岗位", "Untitled position")}</strong>
        <span>{[item.company, item.location, item.source, item.date_found].filter(Boolean).join(" · ")}</span>
      </summary>
      <dl>
        {fields
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {item.fit_note && (
        <p className={css.note}>
          {t("来源推荐说明：", "Source recommendation: ")}
          {item.fit_note}
        </p>
      )}
      {link ? (
        <a href={link} target="_blank" rel="noreferrer">
          {t("打开原始来源", "Open original source")}
        </a>
      ) : (
        <p>
          {t("没有可打开的来源链接。", "No source link available.")}
          {item.url && ` ${item.url}`}
        </p>
      )}
    </details>
  );
}

export function JobsPage(props: JobsPageProps) {
  const t = useT();
  const [data, setData] = useState<JobsData | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await props.loadJobs());
      setError("");
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.loadJobs]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  return (
    <section className={css.page} aria-label={t("岗位箱", "Job inbox")}>
      <header>
        <h1>{t("岗位箱", "Job inbox")}</h1>
        <p>
          {t(
            "读取已有岗位来源，展开查看详情。",
            "Read existing job sources and expand a position for details.",
          )}
        </p>
        <button type="button" onClick={() => void refresh()}>
          {t("重新读取", "Reload")}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <output>{t("正在读取岗位…", "Loading positions…")}</output>}
      {data && (
        <p>{t(`共 ${data.items.length} 个岗位`, `${data.items.length} positions`)} · jobs/jobs.json</p>
      )}
      {data && !data.available && (
        <p>
          {t(
            "当前工作区还没有 jobs/jobs.json。把已有 jobs 文件夹放到资料目录后重新读取。",
            "No jobs/jobs.json in this workspace. Place your existing jobs folder in the workspace and reload.",
          )}
        </p>
      )}
      {data?.available && !data.items.length && (
        <p>{t("来源中还没有岗位。", "The source has no positions yet.")}</p>
      )}
      {data?.items.map((item, index) => (
        <JobDetails key={`${index}:${item.id ?? ""}`} item={item} />
      ))}
    </section>
  );
}
