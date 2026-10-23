import { useEffect, useState } from "preact/hooks";
import { type Version, type WorkbenchData, request } from "./api";
import { type Act, Empty, Panel } from "./components";
const PROMPT = `请把你记住的关于我的所有信息完整列出来，尽量保持原文，不要总结或省略。包括：
1. 你保存的记忆条目
2. 我设置的自定义指令或个性化偏好
3. 你从我们的对话里了解到的我的情况：工作、目标、健康、作息、兴趣、正在做的项目、重要的人
按下面的格式输出，每条一行：
[类别] 内容 （如果知道记下的时间，写在最后）`;
interface Counts {
  added?: number;
  updated?: number;
  deleted?: number;
  skipped?: number;
}
interface Preview extends Counts {
  types?: Record<string, Counts>;
  entries?: { title: string; action: string }[];
  ignored?: Record<string, number>;
}
const sources = [
  { id: "chatgpt-conversations", label: "ChatGPT 对话", accept: ".json,.zip" },
  { id: "apple-health", label: "Apple Health", accept: ".zip,.xml" },
  { id: "ics", label: "日历 .ics", accept: ".ics" },
  { id: "nut-ai", label: "Nut AI", accept: ".json" },
];
function CountsView({ value }: { value: Counts }) {
  return (
    <p class="counts">
      新增 <b>{value.added ?? 0}</b> · 更新 <b>{value.updated ?? 0}</b> · 删除 <b>{value.deleted ?? 0}</b> ·
      跳过 <b>{value.skipped ?? 0}</b>
    </p>
  );
}
export function Settings({
  data,
  act,
  busy,
  refresh,
  tell,
  copy,
}: {
  data: WorkbenchData;
  act: Act;
  busy: boolean;
  refresh: () => Promise<void>;
  tell: (message: string) => void;
  copy: (text: string) => void;
}) {
  const [drive, setDrive] = useState<{
    mode: string;
    stateDir: string;
    drivePath: string | null;
    lastInboxProcessed: string | null;
  } | null>(null);
  const [driveDir, setDriveDir] = useState("");
  const [localDir, setLocalDir] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [source, setSource] = useState(sources[0]?.id ?? "chatgpt-conversations");
  const [upload, setUpload] = useState<{ token: string; preview: Preview } | null>(null);
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ result: Preview; before?: string } | null>(null);
  const [error, setError] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const blocked = busy || loading;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 文件刷新后同步版本列表。
  useEffect(() => {
    void request<NonNullable<typeof drive>>("drive")
      .then(setDrive)
      .catch((e) => setError(e.message));
    request<Version[]>("history")
      .then((versions) => {
        setVersions(versions);
        setHistoryError("");
      })
      .catch((e) => setHistoryError(e.message));
  }, [data]);
  useEffect(() => {
    return () => {
      if (upload) void request("import/cancel", { token: upload.token }).catch(() => {});
    };
  }, [upload]);
  const changeSource = (value: string) => {
    setSource(value);
    setUpload(null);
    setResult(null);
    setFilename("");
    setError("");
    setFileKey((key) => key + 1);
  };
  const previewFile = async (file?: File) => {
    setUpload(null);
    setResult(null);
    setError("");
    if (!file) return;
    setFilename(file.name);
    setLoading(true);
    try {
      setUpload(
        await request(
          `import/preview?source=${encodeURIComponent(source)}&name=${encodeURIComponent(file.name)}`,
          {},
          file,
        ),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const confirm = async () => {
    if (!upload) return;
    setLoading(true);
    setError("");
    try {
      setResult(await request("import/confirm", { token: upload.token }));
      setUpload(null);
      await refresh();
      tell("导入完成");
    } catch (error) {
      setError((error as Error).message);
      setUpload(null);
    } finally {
      setLoading(false);
      setFileKey((key) => key + 1);
    }
  };
  return (
    <>
      <header class="page-heading">
        <p class="eyebrow">你的本地工作区</p>
        <h1>设置</h1>
      </header>
      <Panel title="同步到 Google Drive">
        <p>当前模式：{drive?.mode === "drive" ? "Google Drive" : "本地"}</p>
        {drive && <p class="muted path">状态目录：{drive.stateDir}</p>}
        {drive?.drivePath && <p class="muted path">Drive 工作区：{drive.drivePath}</p>}
        <p class="muted">上次处理收件箱：{drive?.lastInboxProcessed ?? "尚未处理"}</p>
        {drive?.mode === "drive" ? (
          <>
            <label>
              本机目标（留空使用 ~/kaitu-ai-memory）
              <input value={localDir} onInput={(e) => setLocalDir(e.currentTarget.value)} />
            </label>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (window.confirm("关闭同步并把工作区搬回本机？"))
                  void act("drive/disable", { to: localDir }, "已搬回本机");
              }}
            >
              关闭同步
            </button>
          </>
        ) : (
          <>
            <label>
              我的云端硬盘目录（留空自动查找）
              <input value={driveDir} onInput={(e) => setDriveDir(e.currentTarget.value)} />
            </label>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (window.confirm("个人数据会存到 Google Drive，版本历史与密钥留在本机。开启同步？")) {
                  void act("drive/enable", { driveDir }, "已开启 Google Drive 同步");
                }
              }}
            >
              开启同步
            </button>
          </>
        )}
      </Panel>
      <Panel title="导入记录">
        <div class="import-controls">
          <label>
            来源
            <select
              value={source}
              disabled={blocked}
              onChange={(event) => changeSource(event.currentTarget.value)}
            >
              {sources.map((source) => (
                <option value={source.id} key={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            本地文件
            <input
              key={fileKey}
              type="file"
              disabled={blocked}
              accept={sources.find((item) => item.id === source)?.accept}
              onChange={(event) => void previewFile(event.currentTarget.files?.[0])}
            />
          </label>
        </div>
        {loading && <output>正在处理 {filename}…</output>}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {upload && (
          <div class="preview">
            <h3>{filename} · 导入预览</h3>
            <CountsView value={upload.preview} />
            {upload.preview.types &&
              Object.entries(upload.preview.types).map(([type, counts]) => (
                <div key={type}>
                  <strong>
                    {{
                      metric: "身体指标",
                      sleep: "睡眠",
                      activity: "活动",
                      meal: "饮食",
                      workout: "训练",
                      event: "日程",
                      symptom: "症状",
                      mood: "心理状态",
                      heart_notification: "心率通知",
                    }[type] ?? type}
                  </strong>
                  <CountsView value={counts} />
                </div>
              ))}
            {upload.preview.entries && (
              <details>
                <summary>对话清单（{upload.preview.entries.length} 段）</summary>
                {upload.preview.entries.map((entry, i) => (
                  <p key={`${entry.title}-${i}`}>
                    {{ added: "新增", updated: "更新", skipped: "跳过" }[entry.action]} · {entry.title}
                  </p>
                ))}
              </details>
            )}
            {Object.entries(upload.preview.ignored ?? {})
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => (
                <p class="muted" key={reason}>
                  另跳过 {count} 条
                  {{
                    unsupported: "未映射数据",
                    incomplete_bp: "不完整血压",
                    meals_without_items: "待分析餐食",
                    exercise_entries: "有氧热量记录",
                  }[reason] ?? "数据"}
                </p>
              ))}
            <div class="actions">
              <button type="button" class="primary" disabled={blocked} onClick={confirm}>
                确认导入
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  setUpload(null);
                  setFilename("");
                  setFileKey((key) => key + 1);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {result && (
          <div class="preview">
            <h3>导入完成</h3>
            <CountsView value={result.result} />
            {result.before && (
              <button
                type="button"
                disabled={blocked}
                onClick={async () => {
                  if (!confirmRestore("撤销这次导入会恢复整个文件夹到导入前，也会撤销此后的修改。继续吗？"))
                    return;
                  if (await act("restore", { version: result.before }, "已恢复到导入前的版本"))
                    setResult(null);
                }}
              >
                撤销这次导入
              </button>
            )}
          </div>
        )}
      </Panel>
      <Panel title="ChatGPT 记忆">
        <p>在 ChatGPT 里发送它，把回答交给 Agent，说「导入 ChatGPT 记忆」。</p>
        <pre class="prompt">{PROMPT}</pre>
        <button type="button" onClick={() => copy(PROMPT)}>
          复制提示词
        </button>
        <p class="muted">ChatGPT 可能漏掉部分条目，建议同时复制「设置 → 个性化 → 记忆 → 管理」中的列表。</p>
      </Panel>
      <Panel title="版本历史">
        {historyError && <p class="error">{historyError}</p>}
        {!versions.length && !historyError && <Empty>还没有版本。</Empty>}
        {versions.map((version) => (
          <div class="list-row" key={version.oid}>
            <div class="grow">
              <strong>{version.message}</strong>
              <p class="muted">{version.time.replace("T", " ").slice(0, 19)}</p>
            </div>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (confirmRestore(`恢复到「${version.message}」？当前内容会先保存为一个版本。`))
                  void act("restore", { version: version.oid }, "已恢复，可在历史里撤销此次恢复");
              }}
            >
              恢复到这个版本
            </button>
          </div>
        ))}
      </Panel>
      <Panel title="模块">
        {data.modules.map((module) => (
          <div class="list-row" key={module.dir}>
            <strong class="grow">{module.def.name}</strong>
            <span class="muted">{module.dir}/</span>
            <span class="badge">{module.def.visibility === "nav" ? "导航" : "Agent 管理"}</span>
          </div>
        ))}
      </Panel>
      <Panel title="隐私">
        <p>默认放在本机 ~/kaitu-ai-memory；开启同步后，数据文件存到你的 Google Drive。</p>
        <p class="muted path">当前工作区：{data.root}</p>
        <p>对话内容会发给你自己选择的模型服务。</p>
      </Panel>
    </>
  );
}
function confirmRestore(message: string): boolean {
  return window.confirm(message);
}
