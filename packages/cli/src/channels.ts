import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
  type ChannelName,
  channelName,
  channelStatus,
  createChannelRuntime,
  credentials,
  loginWeixin,
  pair,
  saveCredentials,
} from "@kaitu/channels";
import type { Workspace } from "@kaitu/core";

async function setup(ws: Workspace, name: ChannelName): Promise<void> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const abort = new AbortController();
  const stop = () => abort.abort();
  rl.on("SIGINT", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const ask = async (label: string, secret = false) => {
    process.stdout.write(label);
    muted = secret;
    try {
      const answer = (await rl.question("", { signal: abort.signal })).trim();
      if (!answer) throw new Error("输入不能为空");
      return answer;
    } finally {
      muted = false;
      if (secret) process.stdout.write("\n");
    }
  };
  try {
    if (name === "telegram") {
      saveCredentials(ws, name, { token: await ask("BotFather 提供的 token：", true) });
    } else if (name === "feishu" || name === "qq") {
      const appId = await ask("App ID：");
      const appSecret = await ask("App Secret：", true);
      saveCredentials(ws, name, { appId, appSecret });
    } else {
      const result = await loginWeixin({
        existing: credentials(ws).weixin,
        display: (link) => console.log(`用手机微信打开登录链接，或在另一块屏幕上打开后扫码：\n${link}`),
        verify: () => ask("输入手机微信显示的数字：", true),
        signal: abort.signal,
      });
      saveCredentials(ws, name, result);
    }
    console.log(`已保存 ${name} 本机凭据。下一步：kaitu channels pair ${name}`);
  } finally {
    rl.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

export async function channelsCommand(
  ws: Workspace,
  args: string[],
  only?: string,
  json = false,
): Promise<void> {
  const [action, input] = args;
  if (action === "status") {
    const status = channelStatus(ws);
    console.log(
      json
        ? JSON.stringify(status, null, 2)
        : status
            .map((channel) => {
              const pairing = channel.paired ? "已配对" : channel.pairingPending ? "等待配对" : "未配对";
              return `${channel.name}：${[
                channel.configured ? "已配置" : "未配置",
                pairing,
                channel.running ? "进程运行中" : "未运行",
              ].join("，")}`;
            })
            .join("\n"),
    );
  } else if (action === "setup") {
    await setup(ws, channelName(input));
  } else if (action === "pair") {
    const name = channelName(input);
    const pending = pair(ws, name);
    console.log(
      `配对码：${pending.code}（10 分钟有效，一次性）\n启动 kaitu channels start --only ${name} 后，从手机私聊机器人发送此码。`,
    );
  } else if (action === "start") {
    const runtime = createChannelRuntime(ws, only === undefined ? undefined : channelName(only));
    installShutdown(() => runtime.stop());
    await runtime.start();
    console.log("手机通道已启动。按 Ctrl+C 退出。");
  } else {
    throw new Error("使用 channels setup <通道> / pair <通道> / start [--only <通道>] / status");
  }
}

export function installShutdown(close: () => Promise<void>): void {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
