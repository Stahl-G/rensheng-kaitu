import { isAbsolute, join, relative, sep } from "node:path";
import { KaituError, type Workspace, localStateRoot } from "@kaitu/core";
import { feishuProvider } from "./feishu.js";
import { imapPresets } from "./imap/config.js";
import { imapProvider } from "./imap/watcher.js";
import { makeSlackProvider } from "./slack.js";
import { LocalStore, hash } from "./store.js";
import type { Collector, CollectorAccount, CollectorProvider, CollectorStatus } from "./types.js";

export interface CollectorView extends CollectorStatus {
  id: string;
  kind: string;
  label: string;
  selected: string[];
}
export class CollectorService {
  private store: LocalStore;
  private configKey: string;
  private runners = new Map<string, { collector: Collector; release: () => void; configuration: string }>();
  private timer?: NodeJS.Timeout;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private ws: Workspace,
    root = join(localStateRoot(), "collectors"),
    private providers: Record<string, CollectorProvider> = {
      imap: imapProvider,
      slack: makeSlackProvider(),
      feishu: feishuProvider,
    },
  ) {
    const rel = relative(ws.root, root);
    if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
      throw new KaituError("采集状态目录必须在工作区外", "CHANNEL");
    this.store = new LocalStore(root);
    this.configKey = `accounts:${hash(ws.root)}`;
  }
  private accounts() {
    return this.store.read<CollectorAccount[]>(this.configKey, []);
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.pending.then(run);
    this.pending = result.catch(() => {});
    return result;
  }
  start() {
    void this.exclusive(() => this.reconcile()).catch(() => {});
    this.timer = setInterval(() => {
      void this.exclusive(() => this.reconcile()).catch(() => {});
    }, 10000);
    this.timer.unref();
  }
  private status(id: string, patch: Partial<CollectorStatus>) {
    const key = `${id}:status`;
    this.store.write(key, { ...this.store.read<CollectorStatus>(key, { connected: false }), ...patch });
  }
  private create(account: CollectorAccount) {
    const provider = this.providers[account.kind];
    if (!provider) throw new KaituError("不支持的采集渠道", "CHANNEL");
    return provider.create({
      ws: this.ws,
      account,
      store: this.store,
      status: (patch) => this.status(account.id, patch),
    });
  }
  private async stopAccount(id: string) {
    const runner = this.runners.get(id);
    if (!runner) return;
    try {
      await runner.collector.stop();
    } finally {
      this.runners.delete(id);
      this.status(id, { connected: false });
      runner.release();
    }
  }
  private async reconcile() {
    const accounts = this.closed ? [] : this.accounts();
    for (const id of this.runners.keys()) {
      if (!accounts.some((a) => a.id === id && JSON.stringify(a) === this.runners.get(id)?.configuration))
        await this.stopAccount(id);
    }
    for (const account of accounts) {
      if (this.runners.has(account.id)) continue;
      const release = this.store.lock(`account:${account.id}`);
      if (!release) continue;
      try {
        const collector = this.create(account);
        this.status(account.id, { connected: false, error: "正在连接" });
        this.runners.set(account.id, { collector, release, configuration: JSON.stringify(account) });
        collector.start();
      } catch {
        this.runners.delete(account.id);
        this.status(account.id, { connected: false, error: "账号配置无效，请断开后重新添加" });
        release();
      }
    }
  }
  async request(operation: string, input: Record<string, unknown> = {}): Promise<unknown> {
    return this.exclusive(async () => {
      if (this.closed) throw new KaituError("采集服务已关闭", "CHANNEL");
      if (operation === "list") {
        const accounts: CollectorView[] = this.accounts().map((account) => ({
          id: account.id,
          kind: account.kind,
          label: account.label,
          ...this.store.read<CollectorStatus>(`${account.id}:status`, { connected: false }),
          selected: this.providers[account.kind]?.selection?.(account.settings) ?? [],
        }));
        return { kinds: Object.keys(this.providers), presets: imapPresets, accounts };
      }
      const releaseConfig = this.store.lock(`config:${this.configKey}`);
      if (!releaseConfig) throw new KaituError("另一窗口正在修改设置，请稍后重试", "CHANNEL");
      try {
        const accounts = this.accounts();
        if (operation === "add") {
          const kind = typeof input.kind === "string" ? input.kind : "";
          const provider = this.providers[kind];
          if (!provider) throw new KaituError("不支持的采集渠道", "CHANNEL");
          const settings = await provider.normalize(input);
          const id = hash(`${kind}:${provider.identity(settings)}`);
          if (accounts.some((a) => a.id === id)) throw new KaituError("该账号已添加", "CHANNEL");
          const label = typeof input.label === "string" ? input.label.trim() : "";
          if (!label || label.length > 80) throw new KaituError("请填写账号名称（最多 80 字）", "CHANNEL");
          this.store.write(this.configKey, [...accounts, { id, kind, label, settings }]);
          await this.reconcile();
          return { id };
        }
        const account = accounts.find((a) => a.id === input.id);
        if (!account) throw new KaituError("找不到采集账号", "CHANNEL");
        if (operation === "disconnect") {
          this.store.write(
            this.configKey,
            accounts.filter((a) => a.id !== account.id),
          );
          await this.stopAccount(account.id);
          for (const suffix of ["status", "imap-state", "slack-state", "feishu-state"])
            this.store.remove(`${account.id}:${suffix}`);
          return { disconnected: true };
        }
        if (operation === "test") {
          await this.stopAccount(account.id);
          const release = this.store.lock(`account:${account.id}`);
          if (!release)
            throw new KaituError("该账号正在另一进程中采集，请在那里测试或先退出该进程", "CHANNEL");
          const collector = this.create(account);
          try {
            await collector.test();
            this.status(account.id, { error: "" });
            return { ok: true };
          } catch {
            const error = "连接测试失败，请检查凭据、权限和网络";
            this.status(account.id, { connected: false, error });
            return { ok: false, error };
          } finally {
            await collector.stop();
            release();
            await this.reconcile();
          }
        }
        if (operation === "select") {
          const provider = this.providers[account.kind];
          if (!provider?.select) throw new KaituError("该渠道不支持频道选择", "CHANNEL");
          account.settings = provider.select(account.settings, input.ids);
          await this.stopAccount(account.id);
          this.store.write(this.configKey, accounts);
          await this.reconcile();
          return { selected: provider.selection?.(account.settings) ?? [] };
        }
        throw new KaituError("不支持的采集操作", "CHANNEL");
      } finally {
        releaseConfig();
      }
    });
  }
  async stop() {
    this.closed = true;
    clearInterval(this.timer);
    await this.exclusive(() => this.reconcile());
  }
}
