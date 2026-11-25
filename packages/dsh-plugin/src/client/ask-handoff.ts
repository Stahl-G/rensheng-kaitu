/** A saved capture handed to Ask. The request ID is the capture operation key. */
export interface AskAutoSubmit {
  requestId: string;
  text: string;
  references: string[];
  capturedPath: string;
}

export interface AskHandoffStatus {
  status: "not_found" | "ready" | "running" | "completed" | "failed" | "uncertain";
  sessionId?: string;
}

export interface PortraitDraft {
  root: string;
  text: string;
}

export function lifePortraitPrompt(t: (zh: string, en: string) => string) {
  return t(
    "按 life-portrait 技能，为我生成人生开图",
    "Use the life-portrait skill to create my life portrait.",
  );
}
