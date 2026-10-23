import { assertAgentPath } from "./agent-file-policy.js";
import { KaituError } from "./errors.js";
import { deepFreeze } from "./frozen.js";
import type { Workspace } from "./workspace.js";

/** 仅投影已有 Grok jobs.json 数组，不定义可写记录格式。 */
export interface JobSource {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  date_found?: string;
  posted?: string;
  source?: string;
  url?: string;
  track?: string;
  salary?: string;
  fit_note?: string;
  status?: string;
}
export interface JobsData {
  available: boolean;
  items: JobSource[];
}

export function readJobs(ws: Workspace): JobsData {
  const file = "jobs/jobs.json";
  if (!ws.exists(file)) return { available: false, items: [] };
  assertAgentPath(ws.root, file);
  const items = ws.scanParsed(file, "jobs-source", (text) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new KaituError("jobs/jobs.json 不是有效的 JSON", "INVALID_DOCUMENT");
    }
    if (!Array.isArray(value)) throw new KaituError("jobs/jobs.json 应为岗位数组", "INVALID_DOCUMENT");
    const fields = [
      "id",
      "title",
      "company",
      "location",
      "date_found",
      "posted",
      "source",
      "url",
      "track",
      "salary",
      "fit_note",
      "status",
    ] as const;
    return deepFreeze(
      value.map((row): JobSource => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new KaituError("jobs/jobs.json 含有非对象岗位", "INVALID_DOCUMENT");
        return Object.fromEntries(
          fields.flatMap((key) => {
            const field = row[key];
            if (field == null) return [];
            if (typeof field !== "string")
              throw new KaituError(`jobs/jobs.json 的 ${key} 应为文字或 null`, "INVALID_DOCUMENT");
            return [[key, field]];
          }),
        );
      }),
    );
  });
  if (!items) throw new KaituError("jobs/jobs.json 尚未从云盘下载或正在处理冲突", "CLOUD_UNAVAILABLE");
  return { available: true, items };
}
