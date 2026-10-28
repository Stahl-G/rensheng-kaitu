import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { AtlasResource, DomainRule, DomainScore, MapSettings, MappedDomain } from "@kaitu/cartographer";
import { mapDomains, scoreDomain, totalCoverage } from "@kaitu/cartographer/domains";
import { PARAMETER_PORTS, STYLE_PORTS, settings } from "@kaitu/cartographer/settings";
import { KaituError } from "./errors.js";
import type { AtlasSource } from "./life-atlas-source.js";
import {
  ATLAS_LIMIT,
  atlasStorage,
  deleteAtlasFiles,
  discardAtlasJob,
  terrainFiles,
  terrainKey,
} from "./life-atlas-storage.js";
import { localStateRoot } from "./local-state.js";
import type { Workspace } from "./workspace.js";
export type { MapSettings } from "@kaitu/cartographer";
export type AtlasDomain = MappedDomain & { slot: number; score: DomainScore };
export const atlasParameters = PARAMETER_PORTS,
  atlasStyles: MapSettings["style"][] = STYLE_PORTS;
export interface AtlasCandidate {
  id: string;
  createdAt: string;
  seed: string;
  variant: number;
  settings: MapSettings;
  domains: string[];
  slots: Record<string, number>;
  archived?: boolean;
  deleting?: boolean;
  terrainKey?: string;
}
interface Manifest {
  version: 1;
  active: string | null;
  candidates: AtlasCandidate[];
}
export interface LifeAtlasState {
  loading: boolean;
  running: boolean;
  progress: number;
  error: string | null;
  errorKind?: "source" | "generate";
  active: string | null;
  latest: string | null;
  candidates: AtlasCandidate[];
  modules: AtlasSource["modules"];
  gaps: string[];
  resource?: AtlasResource | null;
  resourceId: string | null;
  storage: ReturnType<typeof atlasStorage>;
  domains: AtlasDomain[];
  coverage: number | null;
}
export interface AtlasGenerateInput {
  settings?: Partial<MapSettings>;
  domains: string[];
  sameTerrain?: boolean;
}
interface Session {
  root: string;
  dir: string;
  manifest: Manifest;
  source?: AtlasSource;
  dirty: boolean;
  loading: boolean;
  running: boolean;
  progress: number;
  sourceError: string | null;
  generationError: string | null;
  latest: string | null;
  requested: boolean;
  refreshTimer?: ReturnType<typeof setTimeout>;
  resources: Map<string, AtlasResource>;
  storage: ReturnType<typeof atlasStorage>;
  listeners: Set<() => void>;
}
const sessions = new Map<string, Session>();
const subscriptions = new Map<string, Set<() => void>>();
function session(ws: Workspace) {
  let s = sessions.get(ws.root);
  if (s) return s;
  const dir = join(
    localStateRoot(),
    "cartography",
    createHash("sha256").update(ws.root).digest("hex").slice(0, 24),
  );
  const manifest: Manifest = existsSync(join(dir, "manifest.json"))
    ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
    : { version: 1, active: null, candidates: [] };
  if (manifest.version !== 1 || !Array.isArray(manifest.candidates))
    throw new KaituError("地图存档版本不可读取", "INVALID_CONFIG");
  s = {
    root: ws.root,
    dir,
    manifest,
    dirty: true,
    loading: false,
    running: false,
    progress: 0,
    sourceError: null,
    generationError: null,
    latest: null,
    requested: false,
    resources: new Map(),
    storage: atlasStorage(dir, manifest.candidates.length),
    listeners: subscriptions.get(ws.root) ?? new Set(),
  };
  subscriptions.set(ws.root, s.listeners);
  sessions.set(ws.root, s);
  return s;
}
function notify(s: Session) {
  for (const callback of s.listeners) callback();
}
function persist(s: Session, manifest = s.manifest) {
  mkdirSync(s.dir, { recursive: true, mode: 0o700 });
  const p = join(s.dir, "manifest.json");
  writeFileSync(`${p}.tmp`, JSON.stringify(manifest), { mode: 0o600 });
  renameSync(`${p}.tmp`, p);
  s.manifest = manifest;
}
function job<T>(data: object, progress?: (fraction: number) => void): Promise<T> {
  const entry = [
    "./life-atlas-worker.js",
    "../dist/life-atlas-worker.js",
    "../engine/life-atlas-worker.js",
    "../../dist/engine/life-atlas-worker.js",
  ]
    .map((path) => new URL(path, import.meta.url))
    .find((path) => existsSync(fileURLToPath(path)));
  if (!entry) return Promise.reject(new Error("地图生成组件缺失，请重新安装完整功能包"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let settled = false;
    const finish = async (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      if (error) reject(error);
      else resolve(result as T);
    };
    const timer = setTimeout(() => finish(new Error("地图处理超时，已有存档保持不变")), 60_000);
    worker.on("message", (message) => {
      if (message.progress) progress?.(message.progress.fraction);
      else if (message.error) finish(new Error(message.error));
      else finish(undefined, message.result);
    });
    worker.once("error", finish);
    worker.once("exit", () => {
      if (!settled) finish(new Error("地图处理未完成，已有存档保持不变"));
    });
  });
}
function refreshSource(s: Session, now = new Date()) {
  if (!s.requested || !s.dirty || s.loading) return;
  clearTimeout(s.refreshTimer);
  s.dirty = false;
  s.loading = true;
  void job<AtlasSource>({ kind: "source", root: s.root, now: now.toISOString() })
    .then((source) => {
      s.source = source;
      s.sourceError = null;
    })
    .catch((error) => {
      s.sourceError = error.message;
    })
    .finally(() => {
      s.loading = false;
      notify(s);
      if (s.dirty) refreshSource(s, now);
    });
}
/** File watchers invalidate once; page reads use the in-memory projection. */
export function invalidateLifeAtlas(ws: Workspace, file?: string) {
  if (
    file &&
    file !== "工作区" &&
    !/(?:STATUS\.md|module\.json|me\/goals\.json|me\/profile\.md|.*\.jsonl)$/.test(file)
  )
    return;
  const s = sessions.get(ws.root);
  if (s) {
    s.dirty = true;
    clearTimeout(s.refreshTimer);
    if (s.requested) s.refreshTimer = setTimeout(() => refreshSource(s), 200);
  }
}
export function subscribeLifeAtlas(ws: Workspace, callback: () => void) {
  const listeners = subscriptions.get(ws.root) ?? new Set<() => void>();
  subscriptions.set(ws.root, listeners);
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
function resource(s: Session, id: string) {
  let value = s.resources.get(id);
  if (value) return value;
  value = JSON.parse(readFileSync(join(s.dir, "maps", `${id}.json`), "utf8")) as AtlasResource;
  s.resources.set(id, value);
  if (s.resources.size > 3) s.resources.delete(s.resources.keys().next().value as string);
  return value;
}
export function readLifeAtlas(
  ws: Workspace,
  id?: string,
  now = new Date(),
  knownResourceId?: string,
): LifeAtlasState {
  const s = session(ws);
  s.requested = true;
  const window = s.source?.selectionWindow;
  if (
    !s.loading &&
    !s.sourceError &&
    window &&
    ((window.from !== null && now.getTime() < window.from) ||
      (window.until !== null && now.getTime() >= window.until))
  )
    s.dirty = true;
  refreshSource(s, now);
  const candidate = s.manifest.candidates.find((c) => c.id === (id ?? s.manifest.active) && !c.archived);
  if (id && !candidate) throw new KaituError("地图方案不存在", "NOT_FOUND");
  const mapped = s.source
    ? mapDomains(s.source.data, {
        version: 1,
        discover: false,
        domains: (candidate?.domains ?? []).map(
          (id) =>
            s.source?.rules.find((r) => r.id === id) ??
            ({
              id,
              title: id,
              includeDomains: [id],
              temporal: { kind: "live", cadenceDays: 14 },
              facets: [],
            } as DomainRule),
        ),
      })
    : [];
  const domains = mapped.map((d) => ({
    ...d,
    slot: candidate?.slots[d.id] ?? 0,
    score: scoreDomain(d, now),
  }));
  return {
    loading: s.loading,
    running: s.running,
    progress: s.progress,
    error: s.sourceError ?? s.generationError,
    errorKind: s.sourceError ? "source" : s.generationError ? "generate" : undefined,
    active: s.manifest.active,
    latest: s.latest,
    candidates: s.manifest.candidates,
    modules: s.source?.modules ?? [],
    gaps: s.source?.gaps ?? [],
    resource: candidate ? (knownResourceId === candidate.id ? undefined : resource(s, candidate.id)) : null,
    resourceId: candidate?.id ?? null,
    storage: s.storage,
    domains,
    coverage: totalCoverage(mapped),
  };
}
export function readLifeAtlasProgress(ws: Workspace) {
  const s = session(ws);
  return { running: s.running, progress: s.progress };
}
function capacity(s: Session) {
  s.storage = atlasStorage(s.dir, s.manifest.candidates.length);
  if (s.storage.count >= ATLAS_LIMIT.count || s.storage.bytes >= ATLAS_LIMIT.bytes)
    throw new KaituError("地图存档已达到上限，请在存档中永久删除不需要的已移除方案后重试", "STORAGE_LIMIT");
}
/** Returns immediately. Only this workspace's generation job is exclusive; reads stay available. */
export function generateLifeAtlas(ws: Workspace, input: AtlasGenerateInput) {
  const s = session(ws);
  if (s.running) throw new KaituError("地图正在生成", "BUSY");
  if (!s.source || s.loading)
    throw new KaituError(
      s.sourceError ?? "正在读取模块，请稍后生成",
      s.sourceError ? "SOURCE_UNAVAILABLE" : "BUSY",
    );
  if (
    !input ||
    !Array.isArray(input.domains) ||
    input.domains.length < 1 ||
    input.domains.length > 12 ||
    new Set(input.domains).size !== input.domains.length ||
    input.domains.some((id) => !s.source?.modules.some((m) => m.id === id))
  )
    throw new KaituError("请选择 1–12 个已有领域", "BAD_ARGS");
  const prior = s.manifest.candidates.find((c) => c.id === s.manifest.active);
  const selected = settings(input.settings ?? prior?.settings);
  if (
    input.sameTerrain &&
    prior &&
    JSON.stringify(selected.terrain) !== JSON.stringify(prior.settings.terrain)
  )
    throw new KaituError("改变地形参数需要生成新地形", "BAD_ARGS");
  capacity(s);
  const slots: Record<string, number> = Object.assign(
    Object.create(null),
    input.sameTerrain && prior ? prior.slots : {},
  );
  for (const id of input.domains)
    if (slots[id] === undefined) {
      const free = Array.from({ length: 12 }, (_, i) => i).find((i) => !Object.values(slots).includes(i));
      if (free === undefined) throw new KaituError("原地图位置已用完，请生成新地形", "MAP_FULL");
      slots[id] = free;
    }
  const candidate: AtlasCandidate = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    seed: prior?.seed ?? randomUUID(),
    variant:
      input.sameTerrain && prior
        ? prior.variant
        : Math.max(-1, ...s.manifest.candidates.map((c) => c.variant)) + 1,
    settings: selected,
    domains: input.domains,
    slots,
  };
  const before = new Set(terrainFiles(s.dir));
  s.latest = null;
  s.running = true;
  s.progress = 0;
  s.generationError = null;
  void job({ kind: "generate", directory: s.dir, ...candidate }, (fraction) => {
    s.progress = Math.max(0, Math.min(1, fraction));
  })
    .then((result) => {
      candidate.terrainKey = (result as { key: string }).key;
      if (atlasStorage(s.dir, s.manifest.candidates.length).bytes > ATLAS_LIMIT.bytes)
        throw new KaituError("新地图超出存档空间，请永久删除不需要的已移除方案后重试", "STORAGE_LIMIT");
      persist(s, {
        ...s.manifest,
        candidates: [...s.manifest.candidates, candidate],
        active: s.manifest.active ?? candidate.id,
      });
      s.latest = candidate.id;
    })
    .catch((error) => {
      s.generationError = error.message;
      try {
        discardAtlasJob(s.dir, candidate.id, before);
      } catch (cleanup) {
        s.generationError += `；清理未保存地图失败：${(cleanup as Error).message}`;
      }
    })
    .finally(() => {
      s.running = false;
      try {
        s.storage = atlasStorage(s.dir, s.manifest.candidates.length);
      } catch (error) {
        s.generationError = (error as Error).message;
      }
      notify(s);
    });
  notify(s);
  return readLifeAtlas(ws);
}
export type AtlasAction = "adopt" | "archive" | "restore" | "delete";
export function changeLifeAtlas(ws: Workspace, id: string, action: AtlasAction) {
  const s = session(ws);
  const manifest = structuredClone(s.manifest);
  const candidate = manifest.candidates.find((c) => c.id === id);
  if (!candidate) throw new KaituError("地图方案不存在", "NOT_FOUND");
  if (candidate.deleting && action !== "delete") throw new KaituError("请先完成永久删除", "BAD_ARGS");
  if (action === "adopt") {
    if (candidate.archived) throw new KaituError("请先恢复地图", "BAD_ARGS");
    manifest.active = id;
  } else if (action === "archive") {
    if (s.manifest.active === id) throw new KaituError("请先切换地图再移除", "BAD_ARGS");
    candidate.archived = true;
  } else if (action === "restore") candidate.archived = undefined;
  else if (action === "delete") {
    if (s.running) throw new KaituError("请等待当前地图生成完成后删除", "BUSY");
    if (s.manifest.active === id || !candidate.archived)
      throw new KaituError("只能永久删除已移除且非当前的地图", "BAD_ARGS");
    // Persist intent before removing files. An interrupted deletion remains visible and retryable.
    candidate.terrainKey = terrainKey(s.dir, candidate);
    candidate.deleting = true;
    persist(s, structuredClone(manifest));
    const retained = manifest.candidates.filter((c) => c.id !== id);
    deleteAtlasFiles(s.dir, candidate, retained);
    manifest.candidates = retained;
    s.resources.delete(id);
    if (s.latest === id) s.latest = null;
  } else throw new KaituError("未知地图操作", "BAD_ARGS");
  persist(s, manifest);
  s.storage = atlasStorage(s.dir, manifest.candidates.length);
  notify(s);
  return readLifeAtlas(ws);
}
