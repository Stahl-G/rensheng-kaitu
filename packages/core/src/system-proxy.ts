import { execFileSync } from "node:child_process";

// 国内用户多靠 Clash 一类工具设系统代理；邮箱等直连 TCP 的连接不会自动走它，要自己读出来。
export function parseMacProxy(text: string): string | undefined {
  const value = (key: string) => text.match(new RegExp(`\\b${key} : (\\S+)`))?.[1];
  if (value("SOCKSEnable") === "1" && value("SOCKSProxy"))
    return `socks5://${value("SOCKSProxy")}:${value("SOCKSPort") ?? "1080"}`;
  if (value("HTTPSEnable") === "1" && value("HTTPSProxy"))
    return `http://${value("HTTPSProxy")}:${value("HTTPSPort") ?? "443"}`;
  if (value("HTTPEnable") === "1" && value("HTTPProxy"))
    return `http://${value("HTTPProxy")}:${value("HTTPPort") ?? "80"}`;
}

export function parseWindowsProxy(text: string): string | undefined {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(text)) return;
  const server = text.match(/ProxyServer\s+REG_SZ\s+(\S+)/)?.[1];
  if (!server) return;
  if (!server.includes("=")) return `http://${server}`;
  const parts = Object.fromEntries(server.split(";").map((part) => part.split("=") as [string, string]));
  if (parts.socks) return `socks5://${parts.socks}`;
  const http = parts.https ?? parts.http;
  return http ? `http://${http}` : undefined;
}

/** 当前系统代理（环境变量优先），没有设就返回 undefined，直连。 */
export function systemProxy(env = process.env): string | undefined {
  const fromEnv = env.ALL_PROXY || env.all_proxy || env.HTTPS_PROXY || env.https_proxy;
  if (fromEnv) return fromEnv;
  try {
    if (process.platform === "darwin")
      return parseMacProxy(execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8" }));
    if (process.platform === "win32")
      return parseWindowsProxy(
        execFileSync(
          "reg",
          ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
          { encoding: "utf8" },
        ),
      );
  } catch {}
}
