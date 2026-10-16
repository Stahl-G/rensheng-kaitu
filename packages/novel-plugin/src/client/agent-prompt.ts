import type { Context } from "@deepseek-ai/cordis";

// rc.2: workspace-controller/client/service, session-controller/client/sessions/service,
// ui-workspace/client/navigation. Use the owners so workspace feeds and mainView retention stay consistent.
export interface KaituSessionServices {
  workspaces: { create(input: { path: string }): Promise<{ workspaceId: string }> };
  sessions: {
    create(input: { workspaceId: string }): Promise<string>;
    scope(id: string): Context | undefined;
  };
  uiWorkspace: { openSession(id: string): void };
  conversation: { input: { for(scope: Context): { setDraft(text: string): void } } };
  layout: { beginNavigation(): AbortSignal };
}

export async function openKaituSession(
  services: KaituSessionServices,
  workspace: string,
  text?: string,
): Promise<boolean> {
  const navigation = services.layout.beginNavigation();
  const target = await services.workspaces.create({ path: workspace });
  if (navigation.aborted) return false;
  const id = await services.sessions.create({ workspaceId: target.workspaceId });
  if (navigation.aborted) return false;
  services.uiWorkspace.openSession(id);
  if (text) {
    const scope = services.sessions.scope(id);
    if (!scope) throw new Error("开图会话尚未就绪，请重试");
    services.conversation.input.for(scope).setDraft(text);
  }
  return true;
}
