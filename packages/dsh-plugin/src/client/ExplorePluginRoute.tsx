import type { Context } from "@deepseek-ai/cordis";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import { useEffect } from "react";
import { KaituMark } from "./Brand.js";
import css from "./ExplorePluginRoute.module.css";

/** Existing DSH route + frame-wide overlay; the original loader owns plugin rendering. */
export function registerExplorePluginRoute(ctx: Context) {
  const route = new URLSearchParams(window.location.hash.slice(1));
  const page = route.get("kaitu-page");
  const back = URL.parse(route.get("kaitu-return") ?? "");
  if (!page || back?.protocol !== "http:" || back.hostname !== "127.0.0.1") return;
  const returnTo = (view: string) => `${back.origin}/#kaitu-view=${view}`;
  function Navigation() {
    useEffect(() => {
      const padding = document.body.style.paddingTop;
      const sizing = document.body.style.boxSizing;
      document.body.style.paddingTop = "76px";
      document.body.style.boxSizing = "border-box";
      let seen = false;
      const select = () => {
        const present = ctx.slots.entries("main").some((entry) => entry.options.key === page);
        if (present) {
          seen = true;
          ctx.layout.selectPanel(page as MainPanelId);
        } else if (seen) window.location.assign(returnTo("explore"));
      };
      const stop = ctx.slots.subscribe("main", select);
      select();
      return () => {
        stop();
        document.body.style.paddingTop = padding;
        document.body.style.boxSizing = sizing;
      };
    }, [ctx.layout.selectPanel, ctx.slots.entries, ctx.slots.subscribe]);
    const english = document.documentElement.lang.startsWith("en");
    return (
      <header className={css.header}>
        <KaituMark size={34} />
        <nav aria-label={english ? "Kaitu" : "开图导航"}>
          {(
            [
              ["overview", "今天", "Today"],
              ["explore", "开图", "Explore"],
              ["records", "资料", "Library"],
              ["ask", "问问", "Ask"],
            ] as const
          ).map(([id, zh, en]) => (
            <a key={id} href={returnTo(id)} aria-current={id === "explore" ? "page" : undefined}>
              {english ? en : zh}
            </a>
          ))}
        </nav>
      </header>
    );
  }
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register({ name: "shell.overlay", id: "kaitu-explore-navigation" }, Navigation),
  );
}
