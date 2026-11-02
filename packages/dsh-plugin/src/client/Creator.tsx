import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Creator.module.css";
import { useT } from "./i18n.js";

interface Page {
  id: string;
  revision: string;
  name: string;
  title: string;
  installed?: boolean;
  enabled?: boolean;
  incomplete?: boolean;
  version?: string;
}
interface Review extends Page {
  digest: string;
  description: string;
  files: Record<string, string>;
}
interface Status {
  supported: boolean;
  pages: Page[];
  job: { status: string; draft?: Page; error?: string };
}
async function request<T>(action: string, input = {}): Promise<T> {
  const response = await fetch("/api/product/plugins", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify([`creator-${action}`, JSON.stringify(input)]),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}

export function Creator({
  triggerClassName,
  onExplore,
  onConnect,
  active = true,
}: { triggerClassName?: string; onExplore?: () => void; onConnect: () => void; active?: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState<Page | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const seen = useRef("");
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    const value = await request<Status>("status");
    if (current === sequence.current) setStatus(value);
  }, []);
  useEffect(() => {
    void load().catch(() => {});
    return () => {
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    void load().catch((err) => setError(String(err.message)));
    const events = new EventSource("/api/events");
    events.onmessage = () => {
      void load().catch((err) => setError(String(err.message)));
    };
    return () => {
      events.close();
      dialog.current?.close();
    };
  }, [open, load]);
  const run = useCallback(
    async (action: string, input: object) => {
      setWorking(action);
      setError("");
      setReceipt("");
      if (action === "generate") setReview(null);
      try {
        const value = await request(action, input);
        if (action === "review") setReview(value as Review);
        if (action === "install") {
          setReview(null);
          setReceipt(t("已安装 · 页面待验证", "Installed · Page not verified"));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (action === "install") setReview(null);
      } finally {
        if (["install", "enable", "remove"].includes(action))
          window.dispatchEvent(new Event("kaitu:plugins-changed"));
        try {
          await load();
        } catch (err) {
          setError((current) => current || String(err));
        }
        setWorking("");
      }
    },
    [load, t],
  );
  const ready = status?.job.draft;
  useEffect(() => {
    if (open && !working && status?.job.status === "ready" && ready && ready.revision !== seen.current) {
      seen.current = ready.revision;
      void run("review", ready);
    }
  }, [open, working, status?.job.status, ready, run]);
  if (!status?.supported) return null;
  const generating = status.job.status === "generating";
  const busy = !!working || generating;
  const button = (label: string, onClick: () => void, disabled = busy) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
  const close = () => {
    dialog.current?.close();
    setOpen(false);
  };
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {t("创建页面", "Create a page")}
      </button>
      <dialog
        ref={dialog}
        className={css.dialog}
        aria-label={t("创建页面", "Create a page")}
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          if (working) event.preventDefault();
        }}
      >
        <header className={css.actions}>
          <h2>{t("创建页面", "Create a page")}</h2>
          {button(t("关闭", "Close"), close, !!working)}
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run("generate", {
              prompt,
              ...(editing ? { id: editing.id, revision: editing.revision } : {}),
            });
          }}
        >
          <label>
            {editing ? t(`修改：${editing.title}`, `Edit: ${editing.title}`) : t("页面需求", "Page request")}
            <textarea
              value={prompt}
              maxLength={12000}
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("例如：做一个我的阅读进度页", "For example: make a reading progress page")}
            />
          </label>
          <div className={css.actions}>
            <button type="submit" disabled={busy || !prompt.trim()}>
              {generating
                ? t("正在生成…", "Generating…")
                : editing
                  ? t("生成修改", "Generate changes")
                  : t("生成页面", "Generate page")}
            </button>
            {button(t("新页面", "New page"), () => {
              setEditing(null);
              setReview(null);
              setPrompt("");
            })}
            {button(t("AI 与连接", "AI & connections"), () => {
              close();
              onConnect();
            })}
          </div>
        </form>
        {(error || status.job.error) && <p role="alert">{error || status.job.error}</p>}
        {generating && <output aria-live="polite">{t("正在生成页面…", "Generating page…")}</output>}
        {receipt && <output aria-live="polite">{receipt}</output>}
        {review && (
          <section className={css.review} aria-label={t("确认安装", "Confirm installation")}>
            <h3>{review.title}</h3>
            <p>{review.description}</p>
            <dl>
              <dt>{t("访问范围", "Access")}</dt>
              <dd>
                {t(
                  "开图插件环境，含宿主代码权限",
                  "Kaitu plugin environment, including Host code privileges",
                )}
              </dd>
            </dl>
            <details>
              <summary>{t("查看源码", "View source")}</summary>
              {Object.entries(review.files).map(([name, text]) => (
                <div key={name}>
                  <h4>{name}</h4>
                  <pre>{text}</pre>
                </div>
              ))}
            </details>
            <div className={css.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run("install", {
                    id: review.id,
                    revision: review.revision,
                    digest: review.digest,
                    confirmed: true,
                  })
                }
              >
                {working === "install"
                  ? t("正在安装…", "Installing…")
                  : t("确认安装", "Confirm installation")}
              </button>
              {button(t("暂不安装", "Not now"), () => setReview(null), !!working)}
            </div>
          </section>
        )}
        <ul className={css.pages}>
          {status.pages.map((page) => (
            <li key={page.id}>
              <strong>{page.title}</strong>
              <span>
                {page.incomplete
                  ? t("安装未完成", "Installation incomplete")
                  : !page.installed
                    ? t("草稿", "Draft")
                    : page.version !== `0.0.0-${page.revision}`
                      ? t("待确认修改", "Changes to review")
                      : page.enabled
                        ? t("已安装", "Installed")
                        : t("已停用", "Disabled")}
              </span>
              <div className={css.actions}>
                {button(t("查看", "Review"), () => void run("review", page))}
                {button(t("继续修改", "Edit"), () => {
                  setEditing(page);
                  setReview(null);
                  setPrompt("");
                })}
                {page.installed && (
                  <>
                    {button(
                      page.enabled ? t("停用", "Disable") : t("启用", "Enable"),
                      () => void run("enable", { id: page.id, enabled: !page.enabled }),
                    )}
                    {button(t("卸载", "Uninstall"), () => void run("remove", { id: page.id }))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {onExplore &&
          button(
            t("去开图", "Go to Explore"),
            () => {
              close();
              onExplore();
            },
            !!working,
          )}
      </dialog>
    </>
  );
}
