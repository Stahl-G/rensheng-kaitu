import { execFile } from "node:child_process";
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { type By, addRecord, addRecords, deleteRecord, readRecords } from "./records.js";
import { schemas } from "./schema.js";
import { isoInZone, localDate, parseTs } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

export type Pose = "front" | "side" | "back" | "other";
export const POSE_LABELS: Record<Pose, string> = { front: "正面", side: "侧面", back: "背面", other: "其他" };
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export interface PhotoOptions {
  pose: Pose;
  ts?: string;
  notes?: string;
  by: By;
}

function imageFormat(bytes: Buffer): "jpg" | "png" | "webp" | "heic" {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const end = Math.min(bytes.readUInt32BE(0), bytes.length);
    const brands = [bytes.toString("ascii", 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(bytes.toString("ascii", i, i + 4));
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) return "heic";
  }
  throw new KaituError("请选择 JPEG、PNG、WebP 或 HEIC 图片", "INVALID_PHOTO");
}

export function addPhoto(ws: Workspace, sourcePath: string, options: PhotoOptions) {
  if (statSync(sourcePath).size > MAX_PHOTO_BYTES) throw new KaituError("照片不能超过 25MB", "TOO_LARGE");
  return addPhotoBytes(ws, readFileSync(sourcePath), options);
}

export async function addPhotoBytes(ws: Workspace, input: Uint8Array, options: PhotoOptions) {
  if (input.byteLength > MAX_PHOTO_BYTES) throw new KaituError("照片不能超过 25MB", "TOO_LARGE");
  let bytes = Buffer.from(input);
  let format = imageFormat(bytes);
  if (format === "heic") {
    if (process.platform !== "darwin") throw new KaituError("请先导出为 JPG", "INVALID_PHOTO");
    const source = `.kaitu/cache/photos/${ulid()}.heic`;
    const target = source.replace(/heic$/, "jpg");
    ws.writeText(source, bytes, { internal: true, mode: 0o600 });
    try {
      await promisify(execFile)("/usr/bin/sips", [
        "-s",
        "format",
        "jpeg",
        ws.resolve(source, { internal: true }),
        "--out",
        ws.resolve(target, { internal: true }),
      ]);
      bytes = readFileSync(ws.resolve(target, { internal: true }));
      if (imageFormat(bytes) !== "jpg") throw new Error("转换没有生成 JPEG");
      format = "jpg";
    } catch {
      throw new KaituError("HEIC 转换失败，请先导出为 JPG", "INVALID_PHOTO");
    } finally {
      for (const file of [source, target]) rmSync(ws.resolve(file, { internal: true }), { force: true });
    }
  }
  const ts = options.ts ?? isoInZone(new Date(), ws.timeZone());
  const file = `files/photos/${localDate(parseTs(ts), ws.timeZone())}-${ulid()}.${format}`;
  const data = {
    file,
    pose: options.pose,
    ts,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
  addRecords(ws, "photo", [data], { by: options.by, dryRun: true });
  ws.writeText(`health/${file}`, bytes);
  // 所有字段与路径先校验，图片复制成功后才追加记录。
  const written = addRecord(ws, "photo", data, { by: options.by });
  const version = await snapshot(ws, `你添加了一张体态照片（${POSE_LABELS[options.pose]}）`);
  return { ...written, version };
}

function photoRecord(ws: Workspace, id: string) {
  const record = readRecords(ws, "photo").find((row) => row.id === id);
  if (!record) throw new KaituError("照片不存在", "NOT_FOUND");
  if (!schemas().builtin("photo.schema.json")(record))
    throw new KaituError("照片路径不合法", "INVALID_PHOTO");
  return record;
}

function photoPath(ws: Workspace, file: string): string {
  const path = ws.resolve(`health/${file}`);
  if (!realpathSync(path).startsWith(`${join(realpathSync(ws.root), "health/files/photos")}${sep}`)) {
    throw new KaituError("照片路径不合法", "INVALID_PHOTO");
  }
  return path;
}

export function readPhoto(ws: Workspace, id: string) {
  const record = photoRecord(ws, id);
  photoPath(ws, String(record.file));
  const bytes = ws.readBytes(`health/${record.file}`);
  const format = imageFormat(bytes);
  if (format === "heic") throw new KaituError("请先导出为 JPG", "INVALID_PHOTO");
  return { bytes, contentType: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[format] };
}

export async function removePhoto(ws: Workspace, id: string, options: { by?: By; actor?: string } = {}) {
  ws.assertDownloaded("health");
  const record = photoRecord(ws, id);
  const path = `health/${record.file}`;
  if (ws.exists(path)) rmSync(photoPath(ws, String(record.file)));
  const result = deleteRecord(ws, "photo", id, options);
  const version = await snapshot(ws, `${options.actor ?? "你"}删除了一张体态照片`);
  return { ...result, version };
}
