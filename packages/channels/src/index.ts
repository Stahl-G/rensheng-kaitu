import type { Workspace } from "@kaitu/core";
import type { Channel, ChannelError, ChannelName } from "./channel.js";
import { FeishuChannel } from "./feishu.js";
import { QqChannel } from "./qq.js";
import { ChannelRuntime } from "./runtime.js";
import { credentials } from "./state.js";
import { TelegramChannel } from "./telegram.js";
import { WeixinChannel } from "./weixin/index.js";

export * from "./channel.js";
export * from "./runtime.js";
export { channelStatus, credentials, pair, saveCredentials } from "./state.js";
export { loginWeixin } from "./weixin/login.js";

export function configuredChannels(
  ws: Workspace,
  only?: ChannelName,
  onError: ChannelError = report,
): Channel[] {
  const stored = credentials(ws);
  const channels: Channel[] = [];
  if ((!only || only === "telegram") && stored.telegram) {
    channels.push(new TelegramChannel(stored.telegram.token, onError));
  }
  if ((!only || only === "feishu") && stored.feishu) {
    channels.push(new FeishuChannel(stored.feishu.appId, stored.feishu.appSecret, onError));
  }
  if ((!only || only === "qq") && stored.qq) {
    channels.push(new QqChannel(stored.qq.appId, stored.qq.appSecret, onError));
  }
  if ((!only || only === "weixin") && stored.weixin) {
    channels.push(new WeixinChannel(ws, stored.weixin, onError));
  }
  if (only && !channels.length) throw new Error(`${only} 尚未配置，先运行 kaitu channels setup ${only}`);
  return channels;
}

function report(name: ChannelName, detail: string): void {
  console.error(`${name}：${detail}`);
}

export function createChannelRuntime(ws: Workspace, only?: ChannelName): ChannelRuntime {
  const channels = configuredChannels(ws, only);
  if (!channels.length) throw new Error("尚未配置通道，先运行 kaitu channels setup <通道>");
  return new ChannelRuntime(ws, channels);
}

export { PhoneService } from "./phone-service.js";
