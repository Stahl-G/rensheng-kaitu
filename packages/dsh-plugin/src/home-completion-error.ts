import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { KaituError } from "@kaitu/core";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    "kaitu/completion-rejected": { readonly code: string };
  }
}

/** Only explicit pre-write business rejections are safe to retry as a new operation. */
export function throwHomeCompletionError(error: unknown): never {
  if (
    error instanceof KaituError &&
    ["CONFLICT", "BAD_ARGS", "INVALID_DOCUMENT", "INVALID_RECORD"].includes(error.code)
  )
    throw new RemoteError("kaitu/completion-rejected", error.message, { code: error.code });
  throw error;
}
