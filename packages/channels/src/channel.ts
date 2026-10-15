export const channelNames = ["telegram", "feishu", "qq", "weixin"] as const;
export type ChannelName = (typeof channelNames)[number];

export interface ChannelMessage {
  channel: ChannelName;
  chatId: string;
  userId: string;
  text: string;
  ts: number;
}

// 非文本以空 text 交给配对门禁，只有主人会收到不支持提示。
export type OnMessage = (message: ChannelMessage) => Promise<void>;

export interface Channel {
  name: ChannelName;
  start(onMessage: OnMessage): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
}

export function channelName(value: string | undefined): ChannelName {
  if (!channelNames.includes(value as ChannelName)) {
    throw new Error("通道只能是 telegram、feishu、qq 或 weixin");
  }
  return value as ChannelName;
}

export type ChannelError = (name: ChannelName, detail: string) => void;
