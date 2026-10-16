import type { Workspace } from "@kaitu/core";
import type { LocalStore } from "./store.js";

export interface CollectorAccount {
  id: string;
  kind: string;
  label: string;
  settings: Record<string, unknown>;
}
export interface CollectorStatus {
  connected: boolean;
  lastFetch?: string;
  error?: string;
}
export interface CollectorContext {
  ws: Workspace;
  account: CollectorAccount;
  store: LocalStore;
  status: (patch: Partial<CollectorStatus>) => void;
}
export interface Collector {
  start(): void;
  stop(): Promise<void>;
  test(): Promise<void>;
}
export interface CollectorProvider {
  configured?: boolean;
  authorize?(
    store: LocalStore,
    complete: (settings: Record<string, unknown>, label: string) => Promise<void>,
    fail: (error: string) => void,
  ): Promise<() => void>;
  disconnect?(context: CollectorContext): Promise<void>;
  normalize(input: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>;
  identity(settings: Record<string, unknown>): string;
  create(context: CollectorContext): Collector;
  selection?(settings: Record<string, unknown>): string[];
  select?(settings: Record<string, unknown>, ids: unknown): Record<string, unknown>;
}
export interface CollectedMessage {
  source: string;
  account: string;
  channel: string;
  sender: string;
  time: string;
  title: string;
  excerpt: string;
  url: string;
  externalId: string;
  authentication?: string;
}
