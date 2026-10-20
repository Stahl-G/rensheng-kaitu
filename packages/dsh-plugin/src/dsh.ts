// 最小兼容面，按 dsh 0.2.1-rc.2（tag dsh-v0.2.1-rc.2）核对；以后可替换为官方类型。
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// packages/llm/llm/src/types.ts: ToolSchema
// packages/core/tools/src/index.ts: ToolDefinition、ToolOutputDefinition、register
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    readonly schema: Record<string, unknown>;
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
    render(args: unknown, value: JsonValue): { type: "text"; text: string }[];
  };
  execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown>;
}

export type MutationQueue = <T>(run: () => Promise<T>) => Promise<T>;

export interface Context {
  tools: { register(definition: ToolDefinition): () => void };
  // packages/core/system-prompt/src/index.ts: PromptSection、SystemPrompt.section
  systemPrompt?: {
    section(section: { name: string; order: number; text: string; interpolate?: boolean }): () => void;
  };
}

// packages/skill/skill/src/index.ts: SkillProvider seam. No runtime DSH import is needed.
export interface SkillSummary {
  path: string;
  name: string;
  description: string;
  whenToUse?: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  source: string;
  provider: string;
  resourceBase: { kind: "directory"; path: string };
}
export interface SkillCandidate extends SkillSummary {
  rank: number;
  locator: string;
  metadata?: Readonly<Record<string, unknown>>;
}
export interface SkillDefinition extends SkillSummary {
  content: string;
  metadata?: Readonly<Record<string, unknown>>;
}
export interface SkillLookupOptions {
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
}
export interface SkillProvider {
  name: string;
  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]>;
  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>;
}
export interface SkillProviderControl {
  signal: AbortSignal;
  invalidate(): void;
}
export interface SkillContext {
  skills: { registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void };
}
