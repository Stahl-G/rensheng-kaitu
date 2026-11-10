export interface AskEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}
export type EvidenceState =
  | "reading"
  | "read"
  | "saved"
  | "proposed"
  | "preview"
  | "failed"
  | "stopped"
  | "unknown";
export interface AskEvidenceItem {
  id: number;
  name: string;
  target: string;
  lane: "read" | "write";
  state: EvidenceState;
  detail: string;
  recordId?: string;
  task?: boolean;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function parse(value: unknown): Record<string, unknown> {
  try {
    return object(JSON.parse(String(value ?? "{}")));
  } catch {
    return {};
  }
}
export function toolText(content: unknown): string {
  return Array.isArray(content)
    ? content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
    : "";
}
const readNames = new Set([
  "kaitu_status",
  "kaitu_life_map",
  "kaitu_exploration_read",
  "kaitu_experience_imports",
  "kaitu_investment_list",
  "kaitu_phase_list",
  "kaitu_search_chats",
  "kaitu_search_notes",
]);
const writeNames = new Set([
  "kaitu_add_record",
  "kaitu_add_experience",
  "kaitu_exploration_write",
  "project_view_write",
]);
export function toolIntent(
  name: string,
  args: Record<string, unknown>,
): "read" | "write" | "preview" | undefined {
  const action = String(args.operation ?? args.action ?? "");
  if (readNames.has(name)) return "read";
  if (writeNames.has(name)) return "write";
  if (["kaitu_import", "kaitu_restore"].includes(name)) return "preview";
  if (name === "kaitu_onboarding") {
    if (["matter-read", "status"].includes(action)) return "read";
    if (["preview", "setup-preview"].includes(action)) return "preview";
    if (action === "matter-draft") return "write";
    return undefined;
  }
  if (
    [
      "kaitu_workspace",
      "kaitu_tasks",
      "kaitu_records",
      "kaitu_projects",
      "kaitu_memory",
      "kaitu_memories",
      "kaitu_learning",
      "kaitu_inbox",
      "kaitu_photos",
    ].includes(name)
  ) {
    if (/^(read|list|search|show|notes|project-read)$/.test(action)) return "read";
    if (action === "import") return "preview";
    return action ? "write" : undefined;
  }
  // Generic Agent tools stay in the full activity log, without claiming a verified write.
  if (/(?:^|_)(?:read|list|search|fetch|get)(?:_|$)/i.test(name)) return "read";
  return undefined;
}
export function toolFailed(result: AskEvent | undefined): boolean {
  const message = object(result?.data.message);
  const value = parse(toolText(message.content));
  return message.isError === true || value.ok === false || object(value.result).ok === false;
}
export function askEvidence(events: AskEvent[], busy: boolean): AskEvidenceItem[] {
  const results = new Map<unknown, AskEvent>();
  for (const event of events) {
    if (event.type === "tool/result") results.set(object(event.data.message).toolCallId, event);
  }
  const lastUser = events.findLastIndex((event) => event.type === "user/message");
  return events.flatMap((event, index): AskEvidenceItem[] => {
    if (event.type !== "tool/call") return [];
    const args = parse(event.data.arguments);
    const name = String(event.data.name ?? "");
    const intent = toolIntent(name, args);
    if (!intent) return [];
    const result = results.get(event.data.callId);
    const detail = toolText(object(result?.data.message).content);
    const value = parse(detail);
    const payload = object(value.result ?? value);
    const record = object(payload.record);
    const fields = object(args.fields);
    const command = object(args.command);
    const commandData = object(command.data);
    const task =
      (name === "kaitu_tasks" && args.operation === "add") ||
      (name === "kaitu_add_record" && args.type === "task");
    const proposal =
      task ||
      payload.status === "proposed" ||
      record.status === "proposed" ||
      record.status === "suggested" ||
      (name === "kaitu_onboarding" && args.action === "matter-draft") ||
      (name === "kaitu_exploration_write" && command.operation === "create_direction");
    const target = String(
      record.title ??
        args.path ??
        args.file_path ??
        args.file ??
        object(args.task).title ??
        fields.title ??
        commandData.title ??
        args.query ??
        args.slug ??
        args.topic ??
        "",
    );
    const state: EvidenceState = !result
      ? busy && index > lastUser
        ? "reading"
        : "stopped"
      : toolFailed(result)
        ? "failed"
        : intent === "read"
          ? "read"
          : intent === "preview"
            ? "preview"
            : value.ok !== true
              ? "unknown"
              : proposal
                ? "proposed"
                : "saved";
    return [
      {
        id: event.id,
        name,
        target,
        lane: intent === "read" ? "read" : "write",
        state,
        detail,
        recordId:
          typeof record.id === "string" ? record.id : typeof payload.id === "string" ? payload.id : undefined,
        task,
      },
    ];
  });
}
