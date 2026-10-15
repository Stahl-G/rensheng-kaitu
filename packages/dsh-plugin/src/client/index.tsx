import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import contribution from "../../lib/typert.remote-client.js";
import { KaituMark, KaituName, PoweredByDsh } from "./Brand.js";
import { OverviewPage } from "./OverviewPage.js";

export const inject = ["slots", "remote", "layout"];
const panel = "kaitu-overview" as MainPanelId;

export async function apply(ctx: Context) {
  ctx.slots.inject("sidebar.brand.mark", () =>
    ctx.slots.inject("sidebar.brand.name", function* () {
      yield ctx.slots.register({ name: "sidebar.brand.mark" }, KaituMark);
      yield ctx.slots.register({ name: "sidebar.brand.name" }, KaituName);
    }),
  );
  ctx.slots.inject("conversation.hero.brand.mark", () =>
    ctx.slots.register({ name: "conversation.hero.brand.mark" }, KaituMark),
  );
  const unmount = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmount);
  ctx.plugin({
    inject: ["slots", "remote.kaitu", "layout"],
    apply(ctx: Context) {
      const loadVersion = async () => {
        const result = await ctx.remote.kaitu.dshVersion();
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: "kaitu-powered-by", inject: () => ({ load: loadVersion }) },
          PoweredByDsh,
        ),
      );
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
          KaituMark,
        ),
      );
    },
  });
}
