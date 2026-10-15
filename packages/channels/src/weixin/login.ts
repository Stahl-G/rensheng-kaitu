import { setTimeout as delay } from "node:timers/promises";
import type { Credentials } from "../state.js";
import { defaultBaseUrl, request, weixinBaseUrl } from "./api.js";

interface QrCode {
  qrcode: string;
  qrcode_img_content: string;
}

interface LoginStatus {
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export async function loginWeixin(options: {
  display: (link: string) => void;
  verify: () => Promise<string>;
  existing?: Credentials["weixin"];
  signal: AbortSignal;
}): Promise<Credentials["weixin"]> {
  let qr: QrCode | undefined;
  let baseUrl = defaultBaseUrl;
  let verifyCode: string | undefined;
  let refreshes = 0;
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    options.signal.throwIfAborted();
    if (!qr) {
      if (++refreshes > 3) throw new Error("微信登录码多次失效，请重新 setup weixin");
      qr = await request<QrCode>({
        baseUrl: defaultBaseUrl,
        endpoint: "ilink/bot/get_bot_qrcode?bot_type=3",
        body: { local_token_list: options.existing ? [options.existing.token] : [] },
        signal: options.signal,
      });
      if (!qr.qrcode || !qr.qrcode_img_content) throw new Error("微信未返回登录链接");
      options.display(qr.qrcode_img_content);
      baseUrl = defaultBaseUrl;
    }
    let status: LoginStatus;
    try {
      const query = new URLSearchParams({ qrcode: qr.qrcode });
      if (verifyCode) query.set("verify_code", verifyCode);
      status = await request<LoginStatus>({
        baseUrl,
        endpoint: `ilink/bot/get_qrcode_status?${query}`,
        timeoutMs: 35_000,
        signal: options.signal,
      });
    } catch {
      options.signal.throwIfAborted();
      await delay(1000, undefined, { signal: options.signal });
      continue;
    }
    switch (status.status) {
      case "confirmed":
        if (!status.bot_token || !status.ilink_bot_id) throw new Error("微信未返回登录凭据");
        return {
          token: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: weixinBaseUrl(status.baseurl ?? baseUrl),
        };
      case "binded_redirect":
        if (options.existing) return options.existing;
        throw new Error("微信显示已绑定，但本机无凭据，请在微信解除旧绑定后重试");
      case "need_verifycode":
        verifyCode = await options.verify();
        continue;
      case "scaned":
        verifyCode = undefined;
        break;
      case "scaned_but_redirect":
        if (!status.redirect_host) throw new Error("微信未返回机房地址");
        baseUrl = weixinBaseUrl(`https://${status.redirect_host}`);
        break;
      case "expired":
      case "verify_code_blocked":
        qr = undefined;
        verifyCode = undefined;
        break;
    }
    await delay(1000, undefined, { signal: options.signal });
  }
  throw new Error("微信登录超时，请重新 setup weixin");
}
