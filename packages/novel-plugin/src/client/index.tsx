import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import contribution from "../../lib/typert.remote-client.js";
import { type KaituSessionServices, openKaituSession } from "./agent-prompt.js";
import { NovelPage, type Request } from "./page.js";
export const inject = ["slots", "remote", "layout"];
const panel = "kaitu-novel" as MainPanelId;
declare global {
  interface Window {
    __kaituNovelStyles: string;
  }
}
export async function apply(ctx: Context) {
  const style = document.createElement("style");
  style.textContent = window.__kaituNovelStyles;
  document.head.append(style);
  ctx.effect(() => () => style.remove());
  const unmount = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmount);
  ctx.plugin({
    inject: ["slots", "remote.kaituNovel", "layout", "workspaces", "sessions", "uiWorkspace", "conversation"],
    apply(ctx: Context) {
      const request: Request = async <T,>(operation: string, input: object = {}) => {
        const result = await ctx.remote.kaituNovel.request(operation, JSON.stringify(input));
        if (!result.ok) throw new Error(result.error.message);
        return JSON.parse(result.value) as T;
      };
      const onAgent = async (text: string) => {
        const workspace = await request<{ path: string }>("workspace");
        await openKaituSession(
          {
            workspaces: ctx.get("workspaces"),
            sessions: ctx.get("sessions"),
            uiWorkspace: ctx.get("uiWorkspace"),
            conversation: ctx.get("conversation"),
            layout: ctx.layout,
          } as KaituSessionServices,
          workspace.path,
          text,
        );
      };
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: panel, inject: () => ({ request, onAgent }) }, NovelPage),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: panel, order: 25, label: () => "小说工作台" },
          () => <span aria-hidden="true">书</span>,
        ),
      );
    },
  });
}
