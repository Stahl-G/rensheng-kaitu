import type { Context } from "@deepseek-ai/cordis";

interface Sessions {
  list: { getSnapshot(): { byId: Record<string, { id: string; retainedBy: { mainView?: number } }> } };
  scope(id: string): Context | undefined;
}
interface Conversation {
  input: { for(scope: Context): { setDraft(text: string): void } };
}

export function prefillAgent(ctx: Context, text: string): void {
  const sessions = ctx.get("sessions") as Sessions;
  const conversation = ctx.get("conversation") as Conversation;
  const session = Object.values(sessions.list.getSnapshot().byId).find((s) => s.retainedBy.mainView);
  const scope = session && sessions.scope(session.id);
  if (!scope) throw new Error("请先打开一个对话，再编辑档案");
  conversation.input.for(scope).setDraft(text);
}
