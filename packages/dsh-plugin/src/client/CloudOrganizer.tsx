import type { SettingsData } from "@kaitu/core";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function CloudOrganizer({
  data,
  copy,
  setup,
  seen,
}: {
  data: SettingsData;
  copy: (text: string) => Promise<unknown>;
  setup: () => void;
  seen: () => Promise<unknown>;
}) {
  const t = useT();
  const status = data.organizer;
  const agent = status.agent;
  const away = status.away;
  const backup = data.backup.connection;
  const location = backup?.enabled
    ? t(
        `GitHub ${backup.private ? "私有" : "公开"}仓库 ${backup.repo}（只用这个仓库）`,
        `GitHub ${backup.private ? "private" : "public"} repository ${backup.repo} (use only this repository)`,
      )
    : data.storage.mode === "drive"
      ? t(
          `同步盘文件夹 ${data.storage.root.split(/[\\/]/).at(-1)}`,
          `Synced folder ${data.storage.root.split(/[\\/]/).at(-1)}`,
        )
      : null;
  const instructions = t(
    `你是我的「开图整理员」。\n资料位置：${location}。\n每天 06:30、12:30、18:30、22:30 和凌晨 3:00（${data.timeZone}）各运行一次；我说「更新开图」时也运行一次。\n每次运行先读仓库根目录的 ORGANIZER.md，照做，不做它没写的事。`,
    `You are my Kaitu organizer.\nWorkspace: ${location}.\nRun daily at 06:30, 12:30, 18:30, 22:30 and 03:00 (${data.timeZone}), and whenever I say “update Kaitu”.\nRead ORGANIZER.md in the workspace root each time and follow it. Do only what it specifies.`,
  );
  const time = (at: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: data.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(at));
  return (
    <div id="cloud-organizer" className={`${css.card} ${css["list-card"]}`}>
      <div className={css["switch-row"]}>
        <span>
          <b>{agent?.name ?? t("还没设置", "Not set up yet")}</b>
          <br />
          <span className={css.small}>
            {agent
              ? t(`白天 ${time(agent.generatedAt)} 更新了手机`, `Updated phone at ${time(agent.generatedAt)}`)
              : t("还没有整理员来过", "No organizer has visited yet")}
            {status.daily
              ? t(
                  ` · ${status.daily.organizer} 写了 ${status.daily.date} 的每日整理`,
                  ` · ${status.daily.organizer} wrote the ${status.daily.date} daily summary`,
                )
              : ""}
          </span>
        </span>
      </div>
      {location ? (
        <details className={css.sum}>
          <summary className={css.link}>{t("交给 Agent 的说明", "Instructions for your agent")}</summary>
          <pre className={css.detailBody}>{instructions}</pre>
          <button
            type="button"
            className={`${css.btn} ${css["btn-primary"]}`}
            onClick={() => void copy(instructions)}
          >
            {t("复制说明", "Copy instructions")}
          </button>
          <p className={css.small}>
            {t(
              "Agent 会读写这个仓库，读到的内容由它所在的服务处理",
              "The agent reads and writes this workspace; its service processes what it reads",
            )}
          </p>
        </details>
      ) : (
        <div className={css.sum}>
          <p>{t("先开启 GitHub 备份或同步盘", "Enable GitHub backup or a synced folder first")}</p>
          <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={setup}>
            {t("交给 Agent 的说明", "Instructions for your agent")}
          </button>
        </div>
      )}
      <div className={css["switch-row"]}>
        <span>
          <b>{t("手机由谁更新", "Who updates the phone")}</b>
          <br />
          <span className={css.small}>
            {agent
              ? t(
                  `电脑开着时由这台电脑更新，其余时间由 ${agent.name} 更新`,
                  `This computer updates it while running; ${agent.name} updates it otherwise`,
                )
              : t("电脑开着时由这台电脑更新", "This computer updates it while running")}
          </span>
        </span>
        <span className={css.small}>{t("现在：这台电脑", "Now: this computer")}</span>
      </div>
      {away && (
        <details
          className={css.sum}
          onToggle={(event) => {
            if (event.currentTarget.open && status.unread) void seen();
          }}
        >
          <summary className={css.link}>
            {t("电脑不在时", "While this computer was away")}
            {status.unread ? t(" · 未读", " · New") : ""}
          </summary>
          <p>
            {t(
              `${time(away.agent.generatedAt)} ${away.agent.name} 更新了手机`,
              `${time(away.agent.generatedAt)} ${away.agent.name} updated the phone`,
            )}
          </p>
          <p>
            {t(
              `${away.agent.name} 处理了 ${away.actions} 条手机操作，${away.needsReview} 条要核对`,
              `${away.agent.name} handled ${away.actions} phone actions; ${away.needsReview} need review`,
            )}
          </p>
          {away.daily && (
            <p>
              {t(
                `${away.daily.date} ${away.daily.organizer} 写了每日整理`,
                `${away.daily.date} ${away.daily.organizer} wrote the daily summary`,
              )}
            </p>
          )}
          <p>{t(`${time(away.returnedAt)} 电脑回来了`, `${time(away.returnedAt)} this computer returned`)}</p>
        </details>
      )}
    </div>
  );
}
