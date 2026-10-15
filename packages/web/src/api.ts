export type { WorkbenchData, NextItem, PlanBlock, Goal } from "../../core/src/workbench";
export type { StoredRecord } from "../../core/src/records";
export type { Version } from "../../core/src/history";

export async function request<T>(path: string, data?: unknown, bytes?: File): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    data === undefined && !bytes
      ? {}
      : {
          method: "POST",
          headers: {
            "X-Kaitu": "1",
            "Content-Type": bytes ? "application/octet-stream" : "application/json",
          },
          body: bytes ?? JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "请求失败，请重试");
  return result;
}
export function dateOffset(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}
export function dayOf(ts: unknown, zone: string): string {
  const date = new Date(String(ts));
  return Number.isNaN(+date) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
}
export function number(value: unknown, digits = 0): string {
  return typeof value === "number" ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits }) : "—";
}
