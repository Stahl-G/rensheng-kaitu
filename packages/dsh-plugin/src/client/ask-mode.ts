export type AskMode = "scoped" | "full";

export function modeChangeForSend(
  actual: AskMode,
  pending: AskMode | null,
  existing: boolean,
  fullOnly: boolean,
): AskMode | null {
  const desired = fullOnly ? "full" : existing ? actual : (pending ?? actual);
  return desired === actual ? null : desired;
}
