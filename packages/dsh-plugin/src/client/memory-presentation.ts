export function memoryDisplayText(memory: { text: string; origin?: string; uncertainty?: string }): string {
  const label =
    memory.origin === "ai-estimate"
      ? "[AI 估算 / AI estimate · 未核实] "
      : memory.origin === "ai-suggestion"
        ? "[AI 建议 / AI suggestion · 尚未采纳] "
        : "";
  const suffix = `（不确定性 / Uncertainty: ${memory.uncertainty}）`;
  return label && memory.uncertainty && memory.text.startsWith(label) && memory.text.endsWith(suffix)
    ? memory.text.slice(label.length, -suffix.length)
    : memory.text;
}
