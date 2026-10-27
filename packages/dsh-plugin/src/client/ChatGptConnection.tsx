import { useEffect, useRef, useState } from "react";
import css from "./AiSettings.module.css";
import logo from "./chatgpt-logo-white.svg";
import { useT } from "./i18n.js";
import { call } from "./useAiConnection.js";

type Status = {
  authenticated: boolean;
  planEnabled: boolean;
  signingIn: boolean;
  email?: string;
  error?: string;
};
export function ChatGptConnection({ onAuthorized }: { onAuthorized(): void }) {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [welcome, setWelcome] = useState(false);
  const welcomeDialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const authorized = useRef(onAuthorized);
  authorized.current = onAuthorized;
  useEffect(() => {
    if (welcome && welcomeDialog.current && !welcomeDialog.current.open) welcomeDialog.current.showModal();
  }, [welcome]);
  const dismissWelcome = () => {
    localStorage.setItem("kaitu-chatgpt-plan-welcome", "1");
    setWelcome(false);
  };
  const stop = () => {
    pending.current?.abort();
    clearTimeout(timer.current);
  };
  const run = async (name: string) => {
    stop();
    const controller = new AbortController();
    pending.current = controller;
    const current = () => pending.current === controller && !controller.signal.aborted;
    const request = (action: string) => call<Status>("askSupport", [`siwc/${action}`, {}], controller.signal);
    let failures = 0;
    const accept = (next: Status, completedSignIn: boolean) => {
      setStatus(next);
      setError("");
      if (next.signingIn) timer.current = setTimeout(() => void poll(), 1000);
      else if (completedSignIn && next.authenticated && next.planEnabled) {
        if (!localStorage.getItem("kaitu-chatgpt-plan-welcome")) setWelcome(true);
        authorized.current();
      }
    };
    const poll = async () => {
      try {
        const next = await request("status");
        if (!current()) return;
        failures = 0;
        accept(next, true);
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : String(err));
        failures = Math.min(failures + 1, 4);
        timer.current = setTimeout(() => void poll(), Math.min(1000 * 2 ** failures, 10000));
      }
    };
    setBusy(true);
    setError("");
    if (name === "cancelSignIn") setStatus((value) => value && { ...value, signingIn: false });
    try {
      const next = await request(name);
      if (!current()) return;
      accept(next, name === "beginSignIn");
      if (name === "signOut") window.dispatchEvent(new Event("kaitu-ai-changed"));
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current()) setBusy(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount owns the connection request and its cleanup.
  useEffect(() => {
    void run("status");
    return stop;
  }, []);
  return (
    <section aria-label={t("ChatGPT 连接", "ChatGPT connection")} aria-busy={busy}>
      {welcome && (
        <dialog
          ref={welcomeDialog}
          onCancel={dismissWelcome}
          aria-label={t("正在使用 ChatGPT 计划", "You’re using your ChatGPT plan")}
        >
          <p>
            {t(
              "开图中的符合条件的 AI 请求将使用你的 ChatGPT 计划额度。你可以在 ChatGPT 设置中管理用量。",
              "Eligible AI requests in Kaitu use your ChatGPT plan. You can manage usage in ChatGPT settings.",
            )}
          </p>
          <button type="button" onClick={dismissWelcome}>
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
      {!status && busy && (
        <p>
          <output>{t("正在检查 ChatGPT 连接…", "Checking ChatGPT connection…")}</output>
        </p>
      )}
      {status?.authenticated ? (
        <>
          <p>
            {status.planEnabled
              ? t("已连接", "Connected")
              : t("未获 ChatGPT 计划权限", "ChatGPT plan permission not granted")}
            {status.email ? ` · ${status.email}` : ""}
          </p>
          <button type="button" disabled={busy} onClick={() => void run("signOut")}>
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
