import { useEffect, useRef, useState } from "react";
import css from "./AskPage.module.css";

type Entry = { id: string; authKey?: string; authMethods?: { id: string; label: string }[] };
interface AuthState {
  status: "idle" | "running" | "authorized" | "cancelled" | "failed";
  notices?: { message: string; url?: string; code?: string }[];
  prompt?: {
    kind: "text" | "secret" | "select";
    message: string;
    placeholder?: string;
    options?: { id: string; label: string }[];
  };
  error?: string;
}
async function support<T>(method: string, input: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/product/askSupport", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify([method, input]),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "登录未完成");
  return value;
}

/** 呈现 DSH authorization 的通知和问题，凭据只交给该流程自身保存。 */
export function DshAuthorization({ provider, onAuthorized }: { provider: Entry; onAuthorized(): void }) {
  const [state, setState] = useState<AuthState>({ status: "idle" });
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const key = provider.authKey;
  const activeKey = useRef<string | undefined>(undefined);
  const running = state.status === "running";
  useEffect(() => {
    setState({ status: "idle" });
    setAnswer("");
    setError("");
    return () => {
      if (key && activeKey.current === key) void support("authCancel", { key }).catch(() => {});
    };
  }, [key]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: poll restarts only when the login starts or the provider changes.
  useEffect(() => {
    if (!running || !key) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await support<AuthState>("authPoll", { key });
        if (!active) return;
        setState(next);
        if (next.status === "authorized") {
          activeKey.current = undefined;
          onAuthorized();
        } else if (next.status === "running") timer = setTimeout(() => void poll(), 1000);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setState({ status: "failed" });
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [running, key]);
  if (!key || !provider.authMethods?.length) return null;
  return (
    <section className={css.fields} aria-label="服务商登录">
      {!running &&
        provider.authMethods.map((method) => (
          <button
            key={method.id}
            type="button"
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              setError("");
              try {
                await support("authStart", { key, method: method.id });
                activeKey.current = key;
                setState({ status: "running" });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setStarting(false);
              }
            }}
          >
            {method.id === "oauth" ? "用账号登录…" : method.label}
          </button>
        ))}
      {state.notices?.map((notice, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: notices are append-only and have no id.
        <p key={index}>
          {notice.message}{" "}
          {notice.url && /^https?:\/\//.test(notice.url) && (
            <a href={notice.url} target="_blank" rel="noreferrer">
              打开授权页面 ↗
            </a>
          )}
          {notice.code && <code>{notice.code}</code>}
        </p>
      ))}
      {state.prompt && (
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is the select or input below. */}
          <label>
            {state.prompt.message}
            {state.prompt.kind === "select" ? (
              <select value={answer} onChange={(event) => setAnswer(event.target.value)}>
                <option value="">请选择</option>
                {state.prompt.options?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={state.prompt.kind === "secret" ? "password" : "text"}
                autoComplete="off"
                value={answer}
                placeholder={state.prompt.placeholder}
                onChange={(event) => setAnswer(event.target.value)}
              />
            )}
          </label>
          <button
            type="button"
            disabled={!answer}
            onClick={async () => {
              try {
                await support("authAnswer", { key, value: answer });
                setAnswer("");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            继续登录
          </button>
        </div>
      )}
      {running && (
        <button type="button" onClick={() => void support("authCancel", { key })}>
          取消登录
        </button>
      )}
      {state.status === "authorized" && <output>账号已授权</output>}
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
    </section>
  );
}
