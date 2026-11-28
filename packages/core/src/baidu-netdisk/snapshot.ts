import { join } from "node:path";
import { hasFrontmatter, parseFrontmatter } from "../frontmatter.js";
import { redact } from "../handover.js";
import { projectLogs, projectSummary } from "../project-page.js";
import { type ProjectStatus, projectDirectory, projectStatus } from "../projects.js";
import { schemas } from "../schema.js";
import { type Relay, appendFile, directory, hash, incoming, library, openRelay, plainFile } from "./files.js";

export type Format = "md" | "txt";
const clean = (text: string) =>
  redact(text, "zh-CN")
    .replace(/(?:https?|ftp):\/\/[^\s<>"，。；]+/gi, "（链接已省略）")
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim();
function privateItem(item: object) {
  const data = item as Record<string, unknown>;
  return (
    (data.sensitive !== undefined && data.sensitive !== false) ||
    (data.private !== undefined && data.private !== false) ||
    ["private", "sensitive", "confidential"].includes(String(data.visibility ?? "").toLowerCase())
  );
}

export function previewSnapshot(relay: Relay, slug: string, format: Format, includeLog = false) {
  if (format !== "md" && format !== "txt") throw new Error("请选择 md 或 txt 格式");
  projectDirectory(relay.ws, slug);
  if (slug.length > 72 || clean(slug) !== slug) throw new Error("项目标识不适合对外发送");
  const dir = directory(relay.ws.root, ["projects", slug]);
  const source = `projects/${slug}/STATUS.md`;
  const text = plainFile(join(dir, "STATUS.md"), 1024 * 1024).replace(/^\uFEFF/, "");
  if (!hasFrontmatter(text)) throw new Error("项目状态缺少有效的 frontmatter");
  let raw: ProjectStatus;
  try {
    raw = parseFrontmatter<ProjectStatus>(text).data;
  } catch {
    throw new Error("项目状态的 frontmatter 无法解析");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || privateItem(raw))
    throw new Error("请选择非敏感项目");
  const data = projectStatus(raw, slug);
  if (!schemas().builtin("status.schema.json")(data)) throw new Error("项目状态格式不合法");
  const today = new Date().toISOString().slice(0, 10);
  const next = (data.next ?? []).filter((item) => !privateItem(item));
  const tasks = next
    .filter((item) => item.status === "todo")
    .slice(0, 5)
    .map((item) => clean(item.title));
  const results = next
    .filter((item) => item.status === "done" && item.result)
    .sort((a, b) => (b.completed ?? "").localeCompare(a.completed ?? ""))
    .slice(0, 3)
    .map((item) => `${item.completed?.slice(0, 10) ?? "完成日期未记录"} · ${clean(item.result ?? "")}`);
  const sources = [source];
  if (includeLog) {
    const log = plainFile(join(dir, "log.md"), 2 * 1024 * 1024);
    const recent = projectLogs(log).find(
      (entry) =>
        /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
        entry.date <= today &&
        Number.isFinite(Date.parse(entry.date)) &&
        new Date(entry.date).toISOString().slice(0, 10) === entry.date,
    );
    if (recent) {
      // Redact before taking the first two lines of a multiline secret.
      results.push(`${recent.date} · ${clean(projectSummary(redact(recent.text, "zh-CN")))}`);
      sources.push(`projects/${slug}/log.md`);
    }
  }
  const heading = format === "md" ? "# " : "";
  const section = format === "md" ? "## " : "";
  const list = (items: string[]) => (items.length ? items.map((line) => `- ${line}`) : ["暂无可分享条目"]);
  const body = [
    `${heading}${clean(data.title)}`,
    "",
    `快照日期（UTC）：${today}`,
    `项目更新：${data.updated ?? "未记录"}`,
    `来源：${sources.join("、")}`,
    "",
    `${section}下一步`,
    ...list(tasks),
    "",
    `${section}近期结果`,
    ...list(results),
    "",
  ].join("\n");
  const file = `${slug}-${today}-${hash(body).slice(0, 16)}.${format}`;
  const approval = hash(JSON.stringify([relay.ws.root, relay.sync, relay.markerText, file, body]));
  return { file, body, approval };
}

export function publishSnapshot(
  selected: Relay,
  slug: string,
  format: Format,
  includeLog: boolean,
  approval: string,
) {
  // The user may have left the preview open while a folder or pairing changed.
  const relay = openRelay(selected.ws.root, selected.sync);
  const snapshot = previewSnapshot(relay, slug, format, includeLog);
  if (approval !== snapshot.approval) throw new Error("快照或交接位置已变化，请重新预览并确认");
  appendFile(relay.markerFile, relay.markerText);
  directory(relay.sync, [incoming], true);
  const output = directory(relay.sync, [library], true);
  const created = appendFile(join(output, snapshot.file), snapshot.body);
  return {
    local: created ? "created" : "already_present",
    file: `${library}/${snapshot.file}`,
    cloud: "unverified",
  };
}
