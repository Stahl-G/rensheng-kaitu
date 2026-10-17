interface AgentFrame {
  type: string;
  session_id?: string;
  thread_id?: string;
  event?: { delta?: { type: string; text: string } };
  message?:
    | string
    | {
        content?: {
          type: string;
          id: string;
          name: string;
          input: unknown;
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }[];
      };
  is_error?: boolean;
  errors?: string[];
  error?: { message?: string };
  item?: {
    type: string;
    id: string;
    text: string;
    arguments?: unknown;
    command?: string;
    result?: unknown;
    aggregated_output?: string;
    status?: string;
  };
  role?: string;
  content?: string;
  tool_id: string;
  tool_name: string;
  parameters?: unknown;
  output?: unknown;
  status?: string;
}
export function parseAgentFrame(
  format: string,
  frame: AgentFrame,
  output: {
    text: (value: string) => void;
    session: (value: string) => void;
    tool: (id: string, name: string, args: unknown) => void;
    result: (id: string, value: unknown, error?: boolean) => void;
    error: (message: string) => void;
  },
) {
  if (format === "claude") {
    if (frame.session_id) output.session(frame.session_id);
    if (frame.type === "stream_event" && frame.event?.delta?.type === "text_delta")
      output.text(frame.event.delta.text);
    if (frame.type === "assistant") {
      for (const block of (typeof frame.message === "object" ? frame.message.content : []) ?? [])
        if (block.type === "tool_use") output.tool(block.id, block.name, block.input);
    }
    if (frame.type === "user") {
      for (const block of (typeof frame.message === "object" ? frame.message.content : []) ?? [])
        if (block.type === "tool_result") output.result(block.tool_use_id, block.content, block.is_error);
    }
    if (frame.type === "result" && frame.is_error)
      output.error((frame.errors ?? ["Claude 回复未完成"]).join("\n"));
  } else if (format === "codex") {
    if (frame.type === "thread.started") output.session(frame.thread_id);
    if (frame.type === "item.completed" && frame.item?.type === "agent_message") output.text(frame.item.text);
    if (frame.type === "item.started" && frame.item?.type !== "agent_message")
      output.tool(frame.item.id, frame.item.type, frame.item.arguments ?? frame.item.command ?? {});
    if (frame.type === "item.completed" && frame.item?.type !== "agent_message")
      output.result(
        frame.item.id,
        frame.item.result ?? frame.item.aggregated_output ?? frame.item,
        frame.item.status === "failed",
      );
    if (frame.type === "turn.failed" || frame.type === "error")
      output.error(
        frame.error?.message ??
          (typeof frame.message === "string" ? frame.message : undefined) ??
          "Codex 回复未完成",
      );
  } else if (format === "gemini") {
    if (frame.type === "init") output.session(frame.session_id);
    if (frame.type === "message" && frame.role === "assistant") output.text(frame.content ?? "");
    if (frame.type === "tool_use") output.tool(frame.tool_id, frame.tool_name, frame.parameters);
    if (frame.type === "tool_result") output.result(frame.tool_id, frame.output, frame.status === "error");
    if (frame.type === "error")
      output.error((typeof frame.message === "string" ? frame.message : undefined) ?? "Gemini 回复未完成");
  }
}
