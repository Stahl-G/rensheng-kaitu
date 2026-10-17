/** 用于建议正文与摘要；关联资料仍留在 references，不把内部定位符当用户文案。 */
export function directionText(value: string | undefined, limit: number): string {
  const text = (value ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)）\]，。；;]+/gi, "")
    .replace(
      /(?:[A-Za-z]:\\|~\/|\/(?:Users|home|private|tmp|var|Volumes|Applications)\/|(?<![\p{L}\p{N}_])\/|\b(?:projects|memory|inbox|handoffs|feed|me|explore|health|finance|data|docs)\/)[^\s，。；;（）()\[\]]+/gu,
      "",
    )
    .replace(/\b[\w.-]+\.(?:md|jsonl?|ya?ml)(?::L?\d+(?:[-–]\d+)?)?\b/gi, "")
    .replace(/\b[\da-f]{16,}\b/gi, "")
    .replace(/\*\*|`|^#+\s*/gm, "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > limit
    ? `${chars
        .slice(0, limit - 1)
        .join("")
        .trimEnd()}…`
    : text;
}

export function conciseDirection<
  T extends { title: string; motivation: string; hypothesis: string; unknowns?: string },
>(data: T): T {
  return {
    ...data,
    title: directionText(data.title, 60),
    motivation: directionText(data.motivation, 180),
    hypothesis: directionText(data.hypothesis, 180),
    ...(data.unknowns !== undefined ? { unknowns: directionText(data.unknowns, 100) } : {}),
  };
}
