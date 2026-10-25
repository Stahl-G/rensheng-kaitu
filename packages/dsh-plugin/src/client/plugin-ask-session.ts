import type { SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import type { PluginAskServices } from "./PluginAsk.js";

export interface PluginAskSession {
  open(): Promise<SessionReference>;
  dispose(): void;
}

/** The plugin owns its native session across panel unmounts, releasing it on plugin disposal. */
export function createPluginAskSession(services: PluginAskServices): PluginAskSession {
  let opening: Promise<SessionReference> | undefined;
  let reference: SessionReference | undefined;
  let disposed = false;
  const release = () => {
    reference?.release();
    reference = undefined;
  };
  const check = () => {
    if (disposed) throw new Error("Kaitu plugin session is disposed");
  };
  const create = async () => {
    const path = await services.workspacePath();
    check();
    const target = await services.workspaces.create({ path });
    check();
    const id = await services.sessions.create({
      workspaceId: target.workspaceId as NonNullable<
        Parameters<PluginAskServices["sessions"]["create"]>[0]
      >["workspaceId"],
    });
    check();
    const next = services.sessions.retain(id, { source: "kaituAsk" });
    reference = next;
    try {
      await next.ready;
    } catch (error) {
      release();
      throw error;
    }
    check();
    return next;
  };
  return {
    open() {
      if (disposed) return Promise.reject(new Error("Kaitu plugin session is disposed"));
      opening ??= create().catch((error) => {
        opening = undefined;
        throw error;
      });
      return opening;
    },
    dispose() {
      disposed = true;
      release();
    },
  };
}
