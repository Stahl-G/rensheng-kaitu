// Deterministic UI races and native draft delivery. No filesystem/model access.
import { type ReactNode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LearningPage } from "../../packages/dsh-plugin/src/client/LearningPage.js";
import { PluginAsk, type PluginAskServices } from "../../packages/dsh-plugin/src/client/PluginAsk.js";
import type {
  LearningCheckinInput,
  LearningTopic,
  LibraryData,
} from "../../packages/dsh-plugin/src/types.js";

const topics: Record<string, LearningTopic> = Object.fromEntries(
  ["a", "b"].map((topic) => [
    topic,
    { topic, title: `合成主题 ${topic.toUpperCase()}`, notes: "", sources: [], next: [] },
  ]),
);
const data: LibraryData = {
  sections: [],
  inbox: [],
  notes: Object.values(topics).map((topic) => ({
    title: topic.title,
    file: `learning/${topic.topic}/STATUS.md`,
    kind: "笔记",
    status: null,
  })),
};
const loadLearning = async (topic: string) => topics[topic];
function Fixture() {
  const [topic, setTopic] = useState("a");
  const [submitted, setSubmitted] = useState<LearningCheckinInput>();
  const resolveSave = useRef<(value: LearningTopic) => void>();
  const saveLearning = useMemo(
    () => async (input: LearningCheckinInput) => {
      setSubmitted(input);
      return new Promise<LearningTopic>((resolve) => {
        resolveSave.current = resolve;
      });
    },
    [],
  );
  const [draft, setDraft] = useState("");
  const [injections, setInjections] = useState(0);
  const [request, setRequest] = useState(0);
  const services = useMemo(
    () =>
      ({
        sessions: {
          create: async () => "synthetic-session",
          retain: () => ({ sessionId: "synthetic-session", ready: Promise.resolve(), release() {} }),
          scope: () => ({}),
        },
        workspaces: { create: async () => ({ workspaceId: "synthetic-workspace" }) },
        workspacePath: async () => "/synthetic/workspace",
        conversation: {
          input: {
            for: () => ({
              setDraft: (value: string) => {
                setDraft(value);
                setInjections((n) => n + 1);
              },
            }),
          },
        },
      }) as unknown as PluginAskServices,
    [],
  );
  const Provider = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return (
    <main>
      <h1>合成 UI 回归：无模型、无用户资料</h1>
      <section aria-label="挂起保存控制">
        <button
          type="button"
          onClick={() => {
            if (submitted)
              resolveSave.current?.({ ...topics[submitted.topic], notes: submitted.understanding });
          }}
        >
          完成挂起保存
        </button>
        <output>当前主题：{topic}</output>
        <output>提交主题：{submitted?.topic ?? "无"}</output>
      </section>
      <LearningPage
        data={data}
        topic={topic}
        onTopic={setTopic}
        loadLearning={loadLearning}
        startLearning={async () => topics.a}
        saveLearning={saveLearning}
        onSourceConsumed={() => {}}
        onSaved={() => {}}
        onPrompt={() => {}}
      />
      <section aria-label="Native PluginAsk 固定提示回归">
        <h2>原生 PluginAsk 草稿注入（会话服务为桩）</h2>
        <button type="button" onClick={() => setRequest((n) => n + 1)}>
          再次接着学（相同文字）
        </button>
        <button type="button" onClick={() => setDraft("")}>
          模拟发送后清空草稿
        </button>
        <label>
          原生草稿
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <output>注入次数：{injections}</output>
        <PluginAsk
          services={services}
          prompt="相同的合成学习提示"
          promptRequest={request}
          SessionProvider={Provider}
          renderSlot={() => <span>合成原生会话区域</span>}
        />
      </section>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
