export interface ReadIssue {
  code:
    | "invalid_record"
    | "invalid_document"
    | "project_metric"
    | "meal_items"
    | "experience_place_date"
    | "finance_value";
  location: string;
  /** Stable fallback for CLI/MCP; UI translates code instead. */
  message: string;
}
export type ReadWarning = string | ReadIssue;
export const readWarning = (error: KaituError): ReadWarning => error.issue ?? error.message;
export function readIssue(code: ReadIssue["code"], location: string, message: string): ReadIssue {
  return { code, location, message };
}

export class KaituError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly issue?: ReadIssue,
  ) {
    super(message);
    this.name = "KaituError";
  }
}

export class ScopeError extends KaituError {
  constructor(message: string) {
    super(message, "OUT_OF_SCOPE");
  }
}
