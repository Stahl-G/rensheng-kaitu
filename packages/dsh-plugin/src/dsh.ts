// 最小兼容面，按 dsh 0.2.0-rc.2（tag dsh-v0.2.0-rc.2）核对；以后可替换为官方类型。
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// packages/llm/llm/src/types.ts: ToolSchema
// packages/core/tools/src/index.ts: ToolDefinition、ToolOutputDefinition、register
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    readonly schema: Record<string, unknown>;
    render(args: unknown, value: JsonValue): { type: "text"; text: string }[];
  };
  execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface Context {
  tools: { register(definition: ToolDefinition): () => void };
  // packages/core/system-prompt/src/index.ts: PromptSection、SystemPrompt.section
  systemPrompt?: {
    section(section: { name: string; order: number; text: string; interpolate?: boolean }): () => void;
  };
}
