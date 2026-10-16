// Adapted from OpenClaw (MIT), Copyright (c) 2026 OpenClaw Foundation
import type { LocalStore } from "../store.js";
export interface ImapCursor {
  uidValidity: string;
  lastSeenUid: number;
  updatedAt: number;
}
interface ImapState {
  cursor?: ImapCursor;
  messageIds: string[];
  attempts: Record<string, number>;
}
export class ImapStateStore {
  private value: ImapState;
  constructor(
    private store: LocalStore,
    private key: string,
  ) {
    this.value = store.read(key, { messageIds: [], attempts: {} });
  }
  get cursor() {
    return this.value.cursor;
  }
  initialize(uidValidity: string, uidNext: number) {
    if (this.value.cursor?.uidValidity === uidValidity) return;
    this.value.cursor = { uidValidity, lastSeenUid: Math.max(0, uidNext - 1), updatedAt: Date.now() };
    this.value.attempts = {};
    this.save();
  }
  advance(uid: number) {
    if (!this.value.cursor) throw new Error("IMAP 游标未初始化");
    this.value.cursor.lastSeenUid = uid;
    this.value.cursor.updatedAt = Date.now();
    delete this.value.attempts[String(uid)];
    this.save();
  }
  seen(messageId: string) {
    return this.value.messageIds.includes(messageId);
  }
  remember(messageId: string) {
    this.value.messageIds = [...this.value.messageIds, messageId].slice(-100);
    this.save();
  }
  attempt(uid: number) {
    const count = (this.value.attempts[String(uid)] ?? 0) + 1;
    this.value.attempts[String(uid)] = count;
    this.save();
    return count;
  }
  private save() {
    this.store.write(this.key, this.value);
  }
}
