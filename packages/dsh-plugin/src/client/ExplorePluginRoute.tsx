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
    let seen = false;
    const select = () => {
      if (ctx.slots.entries("main").some((entry) => entry.options.key === page)) {
        seen = true;
        ctx.layout.selectPanel(page as MainPanelId);
      } else if (seen) {
        // The host's authentication redirect clears referrer. This carries no data;
        // the parent accepts it only from its current iframe's origin and window.
        window.parent.postMessage({ type: "kaitu:explore-removed" }, "*");
      }
    };
    const stop = ctx.slots.subscribe("main", select);
    select();
    return () => {
      stop();
      document.documentElement.classList.remove(embedded);
    };
  });
}
