export { progressRows, type ProgressRow } from "@kaitu/core/progress-map";
import type { Fact } from "@kaitu/cartographer";
import type { ProgressRow } from "@kaitu/core/progress-map";

export type RecordTarget = Pick<ProgressRow, "kind" | "id">;

export function atlasRecordTarget(fact: Fact): RecordTarget | null {
  if (fact.kind === "goal" && fact.source === "me/goals.json") return { kind: "goal", id: fact.id };
  const project = /^projects\/([^/#]+)\/STATUS\.md$/.exec(fact.source);
  if (project && (fact.kind === "project" || fact.kind === "plan"))
    return { kind: "project", id: project[1] as string };
  const direction = /^record:direction:(.+)$/.exec(fact.id);
  return direction && fact.source.startsWith("explore/")
    ? { kind: "direction", id: direction[1] as string }
    : null;
}
