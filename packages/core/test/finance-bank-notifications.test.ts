import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addRecord,
  bankNotificationCandidates,
  commitFinanceImport,
  financeCashflow,
  financeOverview,
  parseBankNotification,
  pendingWorkspaceFiles,
  readRecords,
  receiveBankNotification,
  snapshot,
  stageFinanceUpload,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("四家动账邮件只进候选，账单唯一匹配后关联，歧义留待核对且候选不计收支", async () => {
  const ws = await freshWorkspace();
  try {
    const names = [
      ["招商银行", "cmbchina.com", "cmb"],
      ["工商银行", "icbc.com.cn", "icbc"],
      ["建设银行", "ccb.com", "ccb"],
      ["中国银行", "boc.cn", "boc"],
    ] as const;
    const mail = (name: string, domain: string) => ({
      sender: `notice@${domain}`,
      subject: `${name}账户动账通知`,
      text: `${name}：您尾号1234的账户于2026-10-01 12:30:00在Synthetic Shop消费人民币12.34元，余额100.00元。`,
      time: "2026-10-01T12:31:00+08:00",
    });
    for (const [name, domain, bank] of names)
      expect(parseBankNotification(mail(name, domain))).toMatchObject({
        bank,
        amount: "-12.34",
        account_last4: "1234",
        counterparty: "Synthetic Shop",
        ts: "2026-10-01T12:30:00+08:00",
      });
    expect(parseBankNotification({ ...mail("招商银行", "unrelated.example"), subject: "营销" })).toBeNull();
    expect(
      parseBankNotification({
        ...mail("招商银行", "cmbchina.com"),
        text: "招商银行：本月账单已生成，余额100.00元。",
      }),
    ).toBeNull();
    expect(
      parseBankNotification({
        ...mail("招商银行", "cmbchina.com"),
        text: "招商银行：尾号1234收款人民币20.00元，对方户名：Synthetic Person。",
      }),
    ).toMatchObject({
      amount: "20.00",
      direction: "income",
      counterparty: "Synthetic Person",
      time_basis: "received",
    });
    const account = addRecord(ws, "finance_account", {
      name: "Synthetic Bank",
      kind: "bank",
      source: "cmb",
      currency: "CNY",
    }).record.id;
    await snapshot(ws, "合成银行账户");
    const notice = receiveBankNotification(ws, mail("招商银行", "cmbchina.com"));
    expect(notice).toMatchObject({ recognized: true, added: true, candidate: { transaction_id: null } });
    expect(receiveBankNotification(ws, mail("招商银行", "cmbchina.com")).added).toBe(false);
    expect(readRecords(ws, "finance_transaction")).toHaveLength(0);
    expect(await pendingWorkspaceFiles(ws)).toEqual([]);
    expect(financeCashflow(ws, "2026-10-01", "2026-10-31").currencies).toHaveLength(0);
    expect(financeOverview(ws).pending.map((p) => p.id)).toContain(notice.candidate?.id);
    const file = stageFinanceUpload(
      ws,
      "bank.csv",
      Buffer.from(
        "记账日期,货币,交易金额,联机余额,交易摘要,对手信息,客户摘要\n2026-10-01,CNY,-12.34,100,消费,Synthetic Shop,Synthetic item\n",
      ),
    );
    await commitFinanceImport(ws, file, { account, accountLast4: "1234" });
    const record = readRecords(ws, "finance_transaction")[0];
    expect(bankNotificationCandidates(ws)[0]?.transaction_id).toBe(record?.id);
    expect(financeOverview(ws).pending).toHaveLength(0);
    expect(financeCashflow(ws, "2026-10-01", "2026-10-31").currencies[0]?.consumption.amount).toBe("12.34");
    addRecord(ws, "finance_transaction", {
      ...record,
      source_transaction_id: "other",
      description: "Synthetic other",
      ts: "2026-10-01T12:35:00+08:00",
    });
    expect(bankNotificationCandidates(ws)[0]?.transaction_id).toBeNull();
    expect(financeOverview(ws).pending.map((p) => p.id)).toContain(notice.candidate?.id);
    expect(readRecords(ws, "finance_transaction")).toHaveLength(2);
    expect(financeCashflow(ws, "2026-10-01", "2026-10-31").currencies[0]?.consumption.amount).toBe("24.68");
    const incomeMail = {
      ...mail("招商银行", "cmbchina.com"),
      text: "招商银行：尾号1234收款人民币20.00元，对方户名：Synthetic Person。",
    };
    const incoming = receiveBankNotification(ws, incomeMail);
    const wallet = addRecord(ws, "finance_transaction", {
      ...record,
      source: "alipay-csv",
      source_transaction_id: "wallet-credit",
      amount: "20.00",
      category: "income",
      account_last4: "1234",
      ts: incomeMail.time,
    }).record;
    expect(bankNotificationCandidates(ws).find((c) => c.id === incoming.candidate?.id)?.transaction_id).toBe(
      wallet.id,
    );
    expect(readRecords(ws, "finance_transaction")).toHaveLength(3);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
