import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { type WorkbenchData, request } from "./api";
import { Health } from "./health";
import { Feed, Me } from "./personal";
import { Settings } from "./settings";
import { Today } from "./today";
import "./style.css";
const pages = ["今天", "健康", "动态", "我的"];
function App() {
  const [page, setPage] = useState("今天");
  const [data, setData] = useState<(WorkbenchData & { watchError?: string }) | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setData(await request("state"));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const stream = new EventSource("/api/events");
    stream.onmessage = () => void refresh();
    stream.onopen = () => {
      setConnected(true);
      void refresh();
    };
    stream.onerror = () => setConnected(false);
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      stream.close();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [message]);
  const act = async (path: string, input: unknown, success: string) => {
    setBusy(true);
    try {
      await request(path, input);
      await refresh();
      setMessage(success);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制");
    } catch {
      setError("复制失败，请手动选择文字复制。");
    }
  };
  return (
    <div class="shell">
      <aside class="sidebar">
        <button type="button" class="brand" onClick={() => setPage("今天")}>
          <span class="brand-mark">开</span>
          <span>
            开图<small>生活，逐渐清晰</small>
          </span>
        </button>
        <nav aria-label="主导航">
          {pages.map((name, index) => (
            <button
              type="button"
              key={name}
              aria-current={page === name ? "page" : undefined}
              class={page === name ? "active" : ""}
              onClick={() => setPage(name)}
            >
              <span class="nav-symbol" aria-hidden="true">
                {["◷", "♡", "≋", "○"][index]}
              </span>
              {name}
            </button>
          ))}
        </nav>
        <div class="sidebar-bottom">
          <span class={`connection ${!connected ? "offline" : ""}`}>
            {connected ? "本地工作区" : "连接中断，正在重连"}
          </span>
          <button type="button" class={page === "设置" ? "active" : ""} onClick={() => setPage("设置")}>
            ⚙ 设置
          </button>
        </div>
      </aside>
      <div class="workspace">
        <div class="agent-bar">
          <span>
            和 Agent 对话：在 <code>{data?.root ?? "工作区"}</code> 打开 Codex 或 Claude Code
          </span>
          <button type="button" disabled={!data} onClick={() => data && void copy(data.root)}>
            复制路径
          </button>
        </div>
        <main>
          {error && (
            <div class="error banner" role="alert">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                重试
              </button>
            </div>
          )}
          {data?.watchError && (
            <p class="error banner" role="alert">
              {data.watchError}
            </p>
          )}
          {data?.warnings.map((warning) => (
            <p key={warning} class="notice">
              {warning}
            </p>
          ))}
          {!data ? (
            <div class="loading">
              <h1>开图</h1>
              <p>正在读取你的本地工作区…</p>
            </div>
          ) : (
            <>
              {page === "今天" && (
                <Today data={data} busy={busy} act={act} settings={() => setPage("设置")} />
              )}
              {page === "健康" && <Health data={data} />}
              {page === "动态" && <Feed data={data} />}
              {page === "我的" && <Me data={data} act={act} busy={busy} />}
              {page === "设置" && (
                <Settings data={data} act={act} busy={busy} refresh={refresh} tell={setMessage} copy={copy} />
              )}
            </>
          )}
        </main>
      </div>
      {message && <output class="toast">{message}</output>}
    </div>
  );
}
render(<App />, document.getElementById("app") as HTMLElement);
