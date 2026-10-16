import { z } from "zod";
import type { ExplorationCommand } from "./exploration.js";
const text = z.string().trim().min(1).max(100000);
const reference = z.object({ kind: z.enum(["project", "decision", "source"]), ref: text }).strict();
const direction = z
  .object({
    title: text,
    motivation: z.string().trim().max(100000),
    hypothesis: z.string().trim().max(100000),
    unknowns: z.string().max(100000).optional(),
    references: z.array(reference).optional(),
  })
  .strict();
const experiment = z
  .object({
    question: text,
    action: text,
    budget: text,
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    criteria: text,
  })
  .strict();
const note = z
  .object({
    kind: z.enum(["evidence", "reflection", "decision"]),
    text,
    stance: z.enum(["unclear", "supports", "refutes"]),
    source: z.string().max(4000).optional(),
    references: z.array(reference).optional(),
  })
  .strict();
const revision = { id: text, expected_revision: z.number().int().min(1) };
export const explorationCommandSchema: z.ZodType<ExplorationCommand> = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("create_direction"),
      data: direction.extend({
        motivation: direction.shape.motivation.default(""),
        hypothesis: direction.shape.hypothesis.default(""),
      }),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update_direction"),
      ...revision,
      data: direction.partial().extend({
        status: z.enum(["suggested", "active", "paused", "archived", "dismissed"]).optional(),
        favorite: z.boolean().optional(),
      }),
    })
    .strict(),
  z
    .object({ operation: z.literal("create_experiment"), data: experiment.extend({ direction_id: text }) })
    .strict(),
  z
    .object({
      operation: z.literal("update_experiment"),
      ...revision,
      data: experiment.partial().extend({
        status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
        result: z.string().max(100000).optional(),
        conclusion: z.enum(["unassessed", "supports", "refutes", "inconclusive"]).optional(),
        source: z.string().max(4000).optional(),
      }),
    })
    .strict(),
  z
    .object({
      operation: z.literal("add_note"),
      data: note.extend({ direction_id: text, experiment_id: text.optional() }),
    })
    .strict(),
  z.object({ operation: z.literal("update_note"), ...revision, data: note.partial() }).strict(),
]);
