import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { type BankMail, isBankNotificationMail } from "./finance/bank-notifications.js";
import type { Workspace } from "./workspace.js";

export function archiveBankMail(
  ws: Workspace,
  mail: BankMail,
  raw: Buffer,
  id: string,
  verified: boolean,
): void {
  const name = createHash("sha256").update(id).digest("hex");
  ws.writeJson(
    `.kaitu/bank-mail-archive/${name}.json`,
    { ...mail, raw: raw.toString("base64"), verified },
    { internal: true, mode: 0o600 },
  );
}
const notePath = /^inbox\/(?:agents|notes|processed)(?:\/[^/]+)*\/channel-[a-f0-9]{64}\.note\.md$/;

export function quarantineBankContent(ws: Workspace, file: string, bytes: Uint8Array): boolean {
  if (!notePath.test(file)) return false;
  const text = Buffer.from(bytes).toString("utf8");
  const field = (name: string) => new RegExp(`^${name}：([^\\r\\n]*)$`, "m").exec(text)?.[1] ?? "";
  if (
    field("来源") !== "imap" ||
    !isBankNotificationMail({
      sender: field("发件人"),
      subject: field("标题"),
      text: "",
      time: field("时间"),
    })
  )
    return false;
  const name = createHash("sha256").update(file).update(bytes).digest("hex");
  ws.writeText(`.kaitu/bank-mail-archive/${name}.note.md`, bytes, { internal: true, mode: 0o600 });
  return true;
}
export function quarantineBankNotes(ws: Workspace): void {
  if (!ws.exists("inbox")) return;
  function walk(directory: string) {
    for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && notePath.test(file) && quarantineBankContent(ws, file, ws.readBytes(file)))
        rmSync(ws.resolve(file));
    }
  }
  walk("inbox");
}
