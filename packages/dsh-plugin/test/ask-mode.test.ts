import { expect, it } from "vitest";
import { modeChangeForSend } from "../src/client/ask-mode.js";

it("新对话第一条按已确认的权限发送，与创建返回的实际权限比较", () => {
  expect(modeChangeForSend("scoped", "full", false, false)).toBe("full");
  expect(modeChangeForSend("full", "full", false, false)).toBeNull();
  expect(modeChangeForSend("scoped", null, false, true)).toBe("full");
});

it("切到已有受限对话时不沿用新对话的完整权限，本机 Agent 仍直接开启", () => {
  expect(modeChangeForSend("scoped", "full", true, false)).toBeNull();
  expect(modeChangeForSend("scoped", null, true, true)).toBe("full");
  expect(modeChangeForSend("full", null, true, true)).toBeNull();
});
