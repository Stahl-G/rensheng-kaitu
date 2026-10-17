import type { Workspace } from "./workspace.js";

export interface PhoneReceipt {
  ref: string;
  kind: "file" | "action";
  status: "applied" | "duplicate" | "conflict" | "rejected";
  message?: string;
  at: string;
}
export function phoneReceipts(ws: Workspace): PhoneReceipt[] {
  return ws.exists("phone/receipts.json")
    ? ws.readJson<{ items: PhoneReceipt[] }>("phone/receipts.json").items
    : [];
}
export function writePhoneReceipts(ws: Workspace, items: PhoneReceipt[], now = new Date()) {
  const cutoff = now.getTime() - 14 * 86400000;
  const previous = phoneReceipts(ws);
  const byRef = new Map(previous.map((item) => [`${item.kind}:${item.ref}`, item]));
  for (const item of items) byRef.set(`${item.kind}:${item.ref}`, item);
  const next = [...byRef.values()].filter((item) => Date.parse(item.at) >= cutoff);
  if (ws.exists("phone/receipts.json") && JSON.stringify(previous) === JSON.stringify(next)) return 0;
  ws.writeJson("phone/receipts.json", {
    format: "kaitu.phone.receipts",
    version: 1,
    generated_at: now.toISOString(),
    items: next,
  });
  return 1;
}
