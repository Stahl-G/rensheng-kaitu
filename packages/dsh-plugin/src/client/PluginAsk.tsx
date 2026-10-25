import type { Context } from "@deepseek-ai/cordis";
import type {
  ISessions,
  SessionReference,
  SessionSnapshot,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {
  ConversationSnapshot,
  ConversationViewsProps,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useState } from "react";
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
  conversation: { input: { for(scope: Context): { setDraft(text: string): void } } };
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
    const scope = services.sessions.scope(reference.sessionId);
    if (scope) services.conversation.input.for(scope).setDraft(prompt);
  }, [reference, prompt, promptRequest, services]);
  if (error) return <p role="alert">{error}</p>;
  if (!reference) return null;
  return (
    <SessionProvider key={reference.sessionId} session={reference}>
      {renderSlot("kaitu.ask.chat", {})}
    </SessionProvider>
  );
}
