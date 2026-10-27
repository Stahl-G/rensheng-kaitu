import { useEffect, useRef, useState } from "react";
import css from "./AiSettings.module.css";
import logo from "./chatgpt-logo-white.svg";
import { useT } from "./i18n.js";

type Status = {
  authenticated: boolean;
  planEnabled: boolean;
  signingIn: boolean;
  email?: string;
  error?: string;
};
async function action(name: string): Promise<Status> {
  const response = await fetch("/api/product/askSupport", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify([`siwc/${name}`, {}]),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "ChatGPT connection failed");
  return value;
}
export function ChatGptConnection({ onAuthorized }: { onAuthorized(): void }) {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const welcomeDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (welcome && welcomeDialog.current && !welcomeDialog.current.open) welcomeDialog.current.showModal();
  }, [welcome]);
  const run = async (name: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await action(name);
      setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  // Load the current local connection when the provider is selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run is recreated with each render.
  useEffect(() => {
    void run("status");
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: poll only for the lifetime of an attempt.
  useEffect(() => {
    if (!status?.signingIn) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await action("status");
        if (!active) return;
        setStatus(next);
        if (!next.signingIn && next.authenticated && next.planEnabled) {
          if (!localStorage.getItem("kaitu-chatgpt-plan-welcome")) setWelcome(true);
          onAuthorized();
        } else if (next.signingIn) timer = setTimeout(() => void poll(), 1000);
      } catch (err) {
        if (active) setError(String(err));
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status?.signingIn]);
  return (
    <section aria-label={t("ChatGPT 连接", "ChatGPT connection")}>
      {welcome && (
        <dialog
          ref={welcomeDialog}
          aria-modal="true"
          onCancel={() => {
            localStorage.setItem("kaitu-chatgpt-plan-welcome", "1");
            setWelcome(false);
          }}
          aria-label={t("正在使用 ChatGPT 计划", "You’re using your ChatGPT plan")}
        >
          <p>
            {t(
              "开图中的符合条件的 AI 请求将使用你的 ChatGPT 计划额度。你可以在 ChatGPT 设置中管理用量。",
              "Eligible AI requests in Kaitu use your ChatGPT plan. You can manage usage in ChatGPT settings.",
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("kaitu-chatgpt-plan-welcome", "1");
              setWelcome(false);
            }}
          >
            {t("知道了", "Got it")}
          </button>
        </dialog>
      )}
      <p>
        {t(
          "使用 ChatGPT 计划额度。标题、压缩和工具审核等后台请求也可能消耗额度。",
          "Uses your ChatGPT plan. Background requests such as titles, compaction and tool review may also use your allowance.",
        )}
      </p>
      <p>
        {t(
          "授权页面显示 DSH ChatGPT SIWC；不会提供 ChatGPT 聊天记录、记忆或连接器。",
          "The authorization page identifies DSH ChatGPT SIWC; it does not grant access to ChatGPT history, memory or connectors.",
        )}
      </p>
      {status?.authenticated ? (
        <>
          <p>
            {status.planEnabled
              ? t("已连接", "Connected")
              : t("未获 ChatGPT 计划权限", "ChatGPT plan permission not granted")}
            {status.email ? ` · ${status.email}` : ""}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run("signOut").then(() => window.dispatchEvent(new Event("kaitu-ai-changed")))
            }
          >
            {t("退出", "Sign out")}
          </button>
        </>
      ) : status?.signingIn ? (
        <button type="button" disabled={busy} onClick={() => void run("cancelSignIn")}>
          {t("取消登录", "Cancel sign-in")}
        </button>
      ) : (
        <button
          type="button"
          className={css.siwcButton}
          disabled={busy || !status}
          onClick={() => void run("beginSignIn")}
        >
          <img src={logo} alt="" width="21" height="21" /> Continue with ChatGPT
        </button>
      )}{" "}
      <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        {t("管理用量", "Manage usage")} ↗
      </a>
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {!status && error && (
        <button type="button" disabled={busy} onClick={() => void run("status")}>
          {t("重试", "Retry")}
        </button>
      )}
    </section>
  );
}
