import { processInbox } from "./inbox.js";
import { phoneReceipts } from "./phone-receipts.js";
import { type PhoneGenerator, writePhoneSnapshots } from "./phone-snapshots.js";
import type { Workspace } from "./workspace.js";

/** 处理收件箱并重写全部手机快照；云端整理员和电脑走同一条路。 */
export async function runPhone(ws: Workspace, generator: PhoneGenerator) {
  const inbox = await processInbox(ws);
  const snapshots = await writePhoneSnapshots(ws, new Date(), { force: true, generator });
  return { inbox, snapshots, receipts: phoneReceipts(ws) };
}
