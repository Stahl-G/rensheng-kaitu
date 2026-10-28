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
