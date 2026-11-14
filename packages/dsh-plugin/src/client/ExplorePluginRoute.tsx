import type { Context } from "@deepseek-ai/cordis";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import css from "./ExplorePluginEmbed.module.css";

/** Select an existing DSH panel; its original loader still owns rendering. */
export function registerExplorePluginRoute(ctx: Context) {
  const route = new URLSearchParams(window.location.hash.slice(1));
  const page = route.get("kaitu-page");
  const embedded = css.embedded;
  if (!embedded || !page || route.get("kaitu-embed") !== "1" || window.parent === window) return;
  ctx.effect(() => {
    document.documentElement.classList.add(embedded);
    const parent = URL.parse(route.get("kaitu-parent") ?? "");
    const parentOrigin =
      parent?.protocol === "http:" && parent.hostname === "127.0.0.1" ? parent.origin : null;
    let seen = false;
    let hasConversation = false;
    const report = () => {
      if (!seen) return;
      const conversation = ctx.layout.panelInfo.getSnapshot().activePanelId === null;
      hasConversation ||= conversation;
      if (parentOrigin)
        window.parent.postMessage(
          { type: "kaitu:explore-navigation", conversation, hasConversation },
          parentOrigin,
        );
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type === "kaitu:explore-return") ctx.layout.selectPanel(page as MainPanelId);
      else if (event.data?.type === "kaitu:explore-conversation" && hasConversation)
        ctx.layout.selectPanel(null);
      else if (event.data?.type === "kaitu:explore-navigation-request") report();
    };
    window.addEventListener("message", receive);
    const stopNavigation = ctx.layout.panelInfo.subscribe(report);
    const select = () => {
      if (ctx.slots.entries("main").some((entry) => entry.options.key === page)) {
        if (!seen) {
          ctx.layout.selectPanel(page as MainPanelId);
          seen = true;
          report();
        }
      } else if (seen) {
        // The host's authentication redirect clears referrer. This carries no data;
        // the parent accepts it only from its current iframe's origin and window.
        window.parent.postMessage({ type: "kaitu:explore-removed" }, "*");
      }
    };
    const stop = ctx.slots.subscribe("main", select);
    select();
    report();
    return () => {
      stop();
      stopNavigation();
      window.removeEventListener("message", receive);
      document.documentElement.classList.remove(embedded);
    };
  });
}
