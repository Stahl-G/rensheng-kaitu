import { randomBytes } from "node:crypto";

export const defaultBaseUrl = "https://ilinkai.weixin.qq.com";

export function weixinBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".weixin.qq.com") || url.username || url.password) {
    throw new Error("微信返回了无法识别的接口地址");
  }
  return url.origin;
}

export async function request<T>(options: {
  baseUrl: string;
  endpoint: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const headers: Record<string, string> = {
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String((2 << 16) | (4 << 8) | 10),
  };
  if (options.body !== undefined) {
    Object.assign(headers, {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE())).toString("base64"),
    });
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(new URL(options.endpoint, `${weixinBaseUrl(options.baseUrl)}/`), {
    method: options.body === undefined ? "GET" : "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal,
  });
  if (!response.ok) throw new Error(`微信接口 HTTP ${response.status}`);
  const result = parseWeixinApiJson<T & { ret?: number; errcode?: number }>(await response.text());
  if (result.ret || result.errcode) {
    const code = result.errcode || result.ret;
    throw new Error(code === -14 ? "微信登录已失效，请重新 setup weixin" : `微信接口错误 ${code}`);
  }
  return result;
}

export const baseInfo = { channel_version: "2.4.10", bot_agent: "Kaitu/0.0.0" };

const LOSSLESS_ID_FIELDS = new Set(["message_id", "msg_id", "svr_id"]);

export function parseWeixinApiJson<T>(rawText: string): T {
  let output = "";
  let index = 0;
  while (index < rawText.length) {
    if (rawText[index] !== '"') {
      output += rawText[index++];
      continue;
    }

    const stringStart = index;
    index++;
    let escaped = false;
    while (index < rawText.length) {
      const char = rawText[index++];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        break;
      }
    }
    const stringToken = rawText.slice(stringStart, index);
    output += stringToken;

    let cursor = index;
    while (/\s/.test(rawText[cursor] ?? "")) cursor++;
    if (rawText[cursor] !== ":") continue;

    let key: unknown;
    try {
      key = JSON.parse(stringToken);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !LOSSLESS_ID_FIELDS.has(key)) continue;

    output += rawText.slice(index, cursor + 1);
    cursor++;
    while (/\s/.test(rawText[cursor] ?? "")) {
      output += rawText[cursor++];
    }
    const numberStart = cursor;
    if (rawText[cursor] === "-") cursor++;
    while (/\d/.test(rawText[cursor] ?? "")) cursor++;
    if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === "-")) {
      output += `"${rawText.slice(numberStart, cursor)}"`;
      index = cursor;
    } else {
      index = numberStart;
    }
  }
  return JSON.parse(output) as T;
}
