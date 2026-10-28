import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assetReturn,
  borrow,
  closeJournal,
  expense,
  income,
  netWorth,
  openJournal,
  repay,
  transfer,
  yuan,
} from "../dist/finance.js";
test("loan, purchase, sale and principal are transfers; unpaid expenses accrue debt exactly once", () => {
  const b = {
    cash: yuan(10000),
    deposits: yuan(5000),
    bonds: 0,
    stocks: 0,
    property: 0,
    debt: 0,
    interestRate: 0.06,
  };
  const j = openJournal(b);
  borrow(b, j, yuan(40000));
  transfer(b, j, "cash", "property", yuan(40000), "purchase");
  income(b, j, yuan(30000), "salary");
  expense(b, j, yuan(20000), "living");
  expense(b, j, yuan(2400), "interest");
  assetReturn(b, j, "property", -0.1);
  transfer(b, j, "property", "cash", b.property, "sale");
  repay(b, j, b.debt);
  closeJournal(b, j);
  assert.equal(netWorth(b), yuan(18600));
  const j2 = openJournal(b);
  expense(b, j2, yuan(50000), "living");
  closeJournal(b, j2);
  assert.equal(b.cash, 0);
  assert.equal(b.deposits, 0);
  assert.equal(b.debt, yuan(31400));
  assert.equal(j2.arrears, yuan(31400));
});
