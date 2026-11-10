import type {
  ISessions,
  SessionReference,
  SessionSnapshot,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {
  ConversationSnapshot,
  ConversationViewsProps,
  IConversation,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n.js";
import type { PluginAskSession } from "./plugin-ask-session.js";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    kaituAsk: unknown;
  }
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "kaitu.ask.chat": { kind: "single"; scope: "session"; owner: Record<string, never> };
  }
}

export interface PluginAskServices {
  sessions: Pick<ISessions, "create" | "retain" | "scope">;
  workspaces: { create(input: { path: string }): Promise<{ workspaceId: string }> };
  conversation: { input: Pick<IConversation["input"], "requestDraftInitialization"> };
  workspacePath: () => Promise<string>;
}

function ChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot("conversation.session", { view: "chat" })}</>;
}

/** 问问页里嵌入的 DSH 对话框，带模型选择和停止生成。 */
export function AskChat({
  useSession,
  useConversation,
  renderFactorySlot,
}: PropsRuntime<"kaitu.ask.chat"> & PropsRenderFactories) {
  const session = useSession((v: SessionSnapshot) => v);
  const conversation = useConversation((v: ConversationSnapshot) => v);
  const active =
    conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running;
  return renderFactorySlot(
    "conversation.content",
    { variant: "embedded", phase: active ? "active" : "hero", hero: !active },
    { slots: { views: ChatView } },
  );
}

/** 插件版的问问：在开图工作区开一个 DSH 会话，就地显示，不跳去 DSH 的对话页。 */
export function PluginAsk({
  services,
  session,
  prompt,
  promptRequest = 0,
  SessionProvider,
  renderSlot,
}: {
  services: PluginAskServices;
  session: PluginAskSession;
  prompt: string;
  promptRequest?: number;
} & PropsRenderSlots<"kaitu.ask.chat">) {
  const t = useT();
  const [pendingPrompts, setPendingPrompts] = useState<string[]>([]);
  const lastRequest = useRef<{ binding: SessionReference["binding"]; prompt: string; request: number }>();
  const [reference, setReference] = useState<SessionReference | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await session.open();
        if (alive) setReference(next);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);
  useEffect(() => {
    if (!reference || (!prompt && !promptRequest)) return;
    const previous = lastRequest.current;
    if (
      previous?.binding === reference.binding &&
      previous.prompt === prompt &&
      previous.request === promptRequest
    )
      return;
    lastRequest.current = { binding: reference.binding, prompt, request: promptRequest };
    const result = services.conversation.input.requestDraftInitialization(reference.binding, {
      prompt,
      whenDraftExists: "append",
    });
    setPendingPrompts((current) =>
      result === "applied"
        ? current.filter((item) => item !== prompt)
        : current.includes(prompt)
          ? current
          : [...current, prompt],
    );
  }, [reference, prompt, promptRequest, services]);
  const pendingPrompt = pendingPrompts.join("\n\n");
  if (error) return <p role="alert">{error}</p>;
  if (!reference) return null;
  return (
    <>
      {pendingPrompt && (
        <details open>
          <summary>{t("待加入问问", "Pending context")}</summary>
          <p>{pendingPrompt}</p>
          <button
            type="button"
            onClick={() => {
              const result = services.conversation.input.requestDraftInitialization(reference.binding, {
                prompt: pendingPrompt,
                whenDraftExists: "append",
              });
              if (result === "applied")
                setPendingPrompts((current) => current.filter((item) => !pendingPrompts.includes(item)));
            }}
          >
            {t("加入草稿", "Add to draft")}
          </button>
        </details>
      )}
      <SessionProvider key={reference.sessionId} session={reference}>
        {renderSlot("kaitu.ask.chat", {})}
      </SessionProvider>
    </>
  );
}
