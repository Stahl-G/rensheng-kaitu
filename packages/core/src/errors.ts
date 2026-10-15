export class KaituError extends Error {
  constructor(
    message: string,
    readonly code: string,
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
