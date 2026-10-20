import { validateFragment } from "@kaitu/core/teaching-frame";
import { byteLength } from "@kaitu/core/teaching-frame";
import { z } from "zod";
import type { Context, JsonValue } from "./dsh.js";

const card = z.object({ title: z.string().trim().min(1).max(200), fragment: z.string() }).strict();
const widget = z
  .object({
    title: z.string().trim().min(1).max(200),
    widgetType: z.enum(["simulation", "game", "code"]),
    html: z.string().min(1),
  })
  .strict();
export function registerLearningAids(ctx: Context) {
  for (const kind of ["card", "widget"] as const) {
    const schema = kind === "card" ? card : widget;
    ctx.tools.register({
      name: `kaitu_learning_${kind}`,
      description:
        kind === "card"
          ? "Show one OpenMAIC concept card or self-graded quiz after the learner attempts a question. fragment is inline HTML (no html/head/body). Use self-contained data and scripts. Quiz answers stay inside the frame; ask the learner to share them if needed."
          : "Show one self-contained HTML interactive simulation/game/code exercise using OpenMAIC's sandboxed widget UI. All data inline, no fetch, uploads or external classroom. Local interaction state resets when reopened. Ask the learner what they observed.",
      parameters: { ...z.toJSONSchema(schema), type: "object" },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: () => [
          {
            type: "text",
            text: "Teaching aid rendered. Interaction stays in the card; no answers were sent back to the model. Ask the learner to explain their reasoning.",
          },
        ],
        presentationMeta: (_args, value) => value,
      },
      async execute(args, exec): Promise<JsonValue> {
        exec.signal.throwIfAborted();
        if (kind === "card") {
          const input = card.parse(args);
          validateFragment(input.fragment, 256 * 1024);
          return { kind: "openmaic-render", ...input };
        }
        const input = widget.parse(args);
        if (byteLength(input.html) > 256 * 1024) throw new Error("互动内容超过 256 KB，请缩小内联数据");
        return { kind: "openmaic-widget", ...input };
      },
    });
  }
}
