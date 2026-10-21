import { expect, it } from "vitest";
import { parseMacProxy, parseWindowsProxy, systemProxy } from "../src/index.js";

it("读出 Clash 一类工具设的系统代理，没开就直连", () => {
  const mac =
    "HTTPSEnable : 1\n  HTTPSPort : 7897\n  HTTPSProxy : 127.0.0.1\n  SOCKSEnable : 1\n  SOCKSPort : 7897\n  SOCKSProxy : 127.0.0.1\n";
  expect(parseMacProxy(mac)).toBe("socks5://127.0.0.1:7897");
  expect(parseMacProxy(mac.replace("SOCKSEnable : 1", "SOCKSEnable : 0"))).toBe("http://127.0.0.1:7897");
  expect(parseMacProxy("HTTPEnable : 0\n")).toBeUndefined();
  const win = "    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    127.0.0.1:7890\n";
  expect(parseWindowsProxy(win)).toBe("http://127.0.0.1:7890");
  expect(parseWindowsProxy(win.replace("127.0.0.1:7890", "http=127.0.0.1:7890;socks=127.0.0.1:7891"))).toBe(
    "socks5://127.0.0.1:7891",
  );
  expect(parseWindowsProxy(win.replace("0x1", "0x0"))).toBeUndefined();
  expect(systemProxy({ HTTPS_PROXY: "http://127.0.0.1:8080" })).toBe("http://127.0.0.1:8080");
});
