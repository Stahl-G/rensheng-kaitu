import type {
  HomeNextTarget,
  HomeResultDraft,
  HomeResultOperation,
  ResultEffect,
  ResultRequest,
} from "@kaitu/core";

export type Step = HomeNextTarget & { key: string; parent: string };
export type ResultTransport = (
  root: string,
  request: ResultRequest,
) => Promise<{ status: "applied" | "duplicate"; effect: ResultEffect }>;
export type DraftTransport = (
  root: string,
  value: HomeResultDraft | null,
  expected: HomeResultDraft | null,
) => Promise<HomeResultDraft>;
type Operation = HomeResultOperation;
type Receipt = Operation & { effect: ResultEffect; expires: number };
interface State {
  selected: string | undefined;
  showLatest: boolean;
  drafts: Record<string, string>;
  pending: boolean;
  error: string;
  receipt: Receipt | undefined;
}
export const RESULT_UNDO_MS = 5000;
/** ULID wire format, using the browser cryptographic RNG (no Node bundle in the renderer). */
export function resultId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let prefix = "";
  for (let i = 0; i < 10; i++, time = Math.floor(time / 32)) prefix = alphabet[time % 32] + prefix;
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => alphabet[n % 32]).join("");
}
/** Only unfinished transport + drafts persist, never successful-operation history. */
export function createTodayBoardSession(
  root = "",
  storage?: Pick<Storage, "getItem" | "setItem">,
  remote?: DraftTransport,
) {
  let state: State = {
    selected: undefined,
    showLatest: false,
    drafts: {},
    pending: false,
    error: "",
    receipt: undefined,
  };
  const operation = { current: undefined as Operation | undefined };
  const key = `kaitu:result-draft:${root}`;
  let presentation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const store = storage;
  let available = false;
  try {
    const saved = root && store?.getItem(key);
    if (saved) {
      const value = JSON.parse(saved);
      state.drafts = value.drafts ?? {};
      operation.current = value.operation;
    }
    available = !!root && !!store;
  } catch (error) {
    state.error = String(error);
  }
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let confirmed: HomeResultDraft = { drafts: {} };
  let unconfirmed: { value: HomeResultDraft; expected: HomeResultDraft } | undefined;
  let tail = Promise.resolve();
  const persist = () => {
    const saved = JSON.parse(
      JSON.stringify({ drafts: state.drafts, operation: operation.current }),
    ) as HomeResultDraft;
    const write = async () => {
      if (!available) throw new Error("无法保留草稿，请重新打开 / Cannot keep draft; reopen the app");
      if (remote) {
        if (unconfirmed) {
          confirmed = await remote(root, unconfirmed.value, unconfirmed.expected);
          unconfirmed = undefined;
        }
        unconfirmed = { value: saved, expected: confirmed };
        confirmed = await remote(root, saved, confirmed);
        unconfirmed = undefined;
      } else if (store) store.setItem(key, JSON.stringify(saved));
    };
    const next = tail.then(write);
    tail = next.catch(() => {});
    return next;
  };
  const board = {
    operation,
    read: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: <K extends keyof State>(key: K, value: State[K] | ((current: State[K]) => State[K])) => {
      state = { ...state, [key]: typeof value === "function" ? value(state[key]) : value };
      if (key === "drafts")
        void persist().catch((error) => {
          state = { ...state, error: String(error) };
          notify();
        });
      notify();
    },
    expire: () => {
      presentation++;
      clearTimeout(timer);
      board.set("receipt", undefined);
    },
    async send(transport: ResultTransport | undefined, proposed?: Operation) {
      if (state.pending) return;
      // An unresolved write must be confirmed before another operation, even after navigation/restart.
      if (operation.current && proposed && proposed !== operation.current) return;
      const action = operation.current ?? proposed;
      if (!action) return;
      board.expire();
      const startedPresentation = presentation;
      board.set("pending", true);
      board.set("error", "");
      try {
        if (!transport)
          throw new Error("结果保存不可用，请重新打开 / Result saving unavailable; reopen the app");
        operation.current = action;
        await persist(); // Persist original ID and full payload BEFORE the first send.
        const response = await transport(root, action.request);
        if (
          !response ||
          !["applied", "duplicate"].includes(response.status) ||
          !response.effect ||
          response.effect.id !== action.step.id ||
          response.effect.file !== action.step.file ||
          (response.effect.file === "task"
            ? !("rev" in response.effect) ||
              !("prior_rev" in response.effect) ||
              !Number.isInteger(response.effect.rev) ||
              response.effect.rev < 1 ||
              !Number.isInteger(response.effect.prior_rev) ||
              response.effect.prior_rev < 1
            : !("expected_next" in response.effect) ||
              !("prior_next" in response.effect) ||
              !response.effect.expected_next ||
              typeof response.effect.expected_next !== "object" ||
              !response.effect.prior_next ||
              typeof response.effect.prior_next !== "object" ||
              response.effect.expected_next.id !== action.step.id ||
              response.effect.prior_next.id !== action.step.id)
        )
          throw new Error("保存结果未确认，请重试 / Save unconfirmed; retry");
        operation.current = undefined;
        if (
          response.status === "applied" &&
          action.request.op === "complete_next_result" &&
          state.drafts[action.step.key] === action.text
        ) {
          const drafts = { ...state.drafts };
          delete drafts[action.step.key];
          state = { ...state, drafts };
        }
        if (action.request.op.startsWith("restore_") && action.restoreDraft)
          state = { ...state, drafts: { ...state.drafts, [action.step.key]: action.text } };
        try {
          await persist();
        } catch (error) {
          operation.current = action;
          throw error;
        }
        const showReceipt = startedPresentation === presentation;
        board.expire();
        if (action.request.op.startsWith("restore_")) {
          board.set("selected", action.step.key);
        } else if (response.status === "applied" && showReceipt) {
          board.set("receipt", { ...action, effect: response.effect, expires: Date.now() + RESULT_UNDO_MS });
          timer = setTimeout(board.expire, RESULT_UNDO_MS);
          timer.unref?.();
        }
        board.set("showLatest", false);
        return true;
      } catch (error) {
        const failure = error as { code?: string; details?: { code?: string }; message?: string };
        const code = failure?.code === "kaitu/completion-rejected" ? failure.details?.code : failure?.code;
        if (["CONFLICT", "BAD_ARGS", "INVALID_DOCUMENT", "INVALID_RECORD"].includes(String(code))) {
          operation.current = undefined;
          try {
            await persist();
          } catch {
            operation.current = action;
          }
        }
        board.set("error", failure?.message ?? String(error));
      } finally {
        board.set("pending", false);
      }
    },
    async undo(transport: ResultTransport | undefined) {
      const receipt = state.receipt;
      if (!receipt || Date.now() >= receipt.expires || state.pending || operation.current) {
        if (receipt && Date.now() >= receipt.expires) board.expire();
        return;
      }
      const effect = receipt.effect;
      const request: ResultRequest =
        "rev" in effect
          ? {
              client_id: resultId(),
              op: "restore_task_revision",
              args: { id: effect.id, expected_rev: effect.rev, prior_rev: effect.prior_rev },
            }
          : { client_id: resultId(), op: "restore_next", args: effect };
      board.expire();
      await board.send(transport, {
        request,
        step: receipt.step,
        text: receipt.text,
        restoreDraft: receipt.request.op === "complete_next_result",
      });
    },
  };
  const ready =
    remote && root
      ? (async () => {
          state = { ...state, pending: true };
          try {
            confirmed = await remote(root, null, null);
            if (!confirmed.drafts || typeof confirmed.drafts !== "object")
              throw new Error("草稿读取失败 / Cannot read draft");
            state = { ...state, drafts: confirmed.drafts };
            operation.current = confirmed.operation;
            available = true;
          } catch (error) {
            state = { ...state, error: String(error) };
          } finally {
            board.set("pending", false);
          }
        })()
      : Promise.resolve();
  return { ...board, ready };
}
export type TodayBoardSession = ReturnType<typeof createTodayBoardSession>;
