import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import contribution from "../../lib/typert.remote-client.js";
import { OverviewPage } from "./OverviewPage.js";

export const inject = ["slots", "remote", "layout"];
const panel = "kaitu-overview" as MainPanelId;

function KaituIcon({ size }: PropsRuntime<"sidebar.panellist">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M2.5 4.5 6 3l4 1.5 3.5-1.5v8.5L10 13l-4-1.5L2.5 13z" strokeLinejoin="round" />
      <path d="M6 3v8.5M10 4.5V13" />
    </svg>
  );
}

export async function apply(ctx: Context) {
  const unmount = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmount);
  ctx.plugin({
    inject: ["slots", "remote.kaitu", "layout"],
    apply(ctx: Context) {
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: panel,
            inject: () => ({
              load: async () => {
                const result = await ctx.remote.kaitu.overview();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              onAgent: () => ctx.layout.selectPanel(null),
            }),
          },
          OverviewPage,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: panel,
            order: 20,
            label: () => "开图",
          },
          KaituIcon,
        ),
      );
    },
  });
}
