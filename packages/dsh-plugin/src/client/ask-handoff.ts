/** A saved capture handed to Ask. The request ID is the capture operation key. */
export interface AskAutoSubmit {
  requestId: string;
  text: string;
  references: string[];
  capturedPath: string;
}
