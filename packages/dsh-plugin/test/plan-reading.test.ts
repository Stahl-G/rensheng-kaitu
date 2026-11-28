import { expect, it } from "vitest";
import { planHeadline, planReading } from "../src/client/plan-reading.js";

it("keeps a short current goal distinct from uncertain history and deduplicates dated background", () => {
  const first = "【背景】2026-11-16：还缺许可；只有拿到签字才动工。";
  const history = "【2026-11-20 历史考虑】之前考虑换地方，尚未决定。";
  const current = "【当前目标】完成八页分镜，前提是先拿到书面许可。";
  const otherWeek = "【背景】2026-11-22：还缺许可。";
  const input = [first, history, current, first, otherWeek].join(" ");
  expect(planHeadline(input)).toBe("完成八页分镜，前提是先拿到书面许可。");
  expect(planReading(input, "goal")).toEqual([
    { group: "background", date: "2026-11-16", text: "还缺许可；" },
    { group: "background", date: "2026-11-16", text: "只有拿到签字才动工。" },
    { group: "history", date: "2026-11-20", text: "之前考虑换地方，尚未决定。" },
    { group: "goal", text: "完成八页分镜，前提是先拿到书面许可。" },
    { group: "background", date: "2026-11-22", text: "还缺许可。" },
  ]);
});
it("treats legacy unmarked prose as excerpts instead of adopting old ideas or losing caveats", () => {
  const legacy = "Ask the archive. Previously we considered switching towns. Only if the owner replies.";
  expect(planHeadline(legacy)).toBe("Ask the archive.");
  expect(planReading(legacy, "goal").map(({ group }) => group)).toEqual(["goal", "history", "background"]);
  const oneToken = "中".repeat(200);
  expect(planHeadline(oneToken, 48)).toBe(`${"中".repeat(48)}…`);
  expect(planReading(oneToken, "goal")[0]?.text).toBe(oneToken);
});
