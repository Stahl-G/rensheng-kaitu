import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import addFormatsModule from "ajv-formats";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { schemasDir } from "./assets.js";
import { assertCloudDownloaded } from "./sync-files.js";
import { isICloudPath } from "./sync-location.js";

// ajv-formats 是 CommonJS，NodeNext 下 default 导入拿到的是整个 exports 对象
const addFormats = addFormatsModule.default;
const requireValidator = createRequire(import.meta.url);

export const SCHEMA_BASE = "https://kaitu.local/schemas/";

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaRegistry {
  private registry?: Ajv2020;
  private definitions = new Map<string, { $id: string; [key: string]: unknown }>();
  private compiled?: { directory: URL; hash: string };
  private builtins = new Map<string, ValidateFunction>();
  private cache = new Map<string, ValidateFunction>();

  constructor() {
    const dir = schemasDir();
    const hash = createHash("sha256");
    for (const name of readdirSync(dir)
      .filter((name) => name.endsWith(".schema.json"))
      .sort()) {
      const text = readFileSync(join(dir, name), "utf8");
      hash.update(name).update("\0").update(text).update("\0");
      const schema = JSON.parse(text);
      this.definitions.set(schema.$id, schema);
    }
    const sourceHash = hash.digest("hex");
    const directory = new URL("./validators/", import.meta.url);
    try {
      if (JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8")).sourceHash === sourceHash)
        this.compiled = { directory, hash: sourceHash };
    } catch {
      /* Source checkouts or changed schemas use the same runtime compiler as before. */
    }
  }

  private get ajv() {
    if (!this.registry) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      for (const schema of this.definitions.values()) ajv.addSchema(schema);
      this.registry = ajv;
    }
    return this.registry;
  }

  resolveSchema(ref: string): unknown {
    const schema = this.compiled ? this.definitions.get(ref) : this.ajv.getSchema(ref)?.schema;
    if (!schema) throw new Error(`找不到 schema：${ref}`);
    return schema;
  }

  hasBuiltin(name: string): boolean {
    return this.compiled
      ? this.definitions.has(SCHEMA_BASE + name)
      : Boolean(this.ajv.getSchema(SCHEMA_BASE + name));
  }

  /** 内置 schema 用文件名（如 workout.schema.json）取。 */
  builtin(name: string): ValidateFunction {
    const cached = this.builtins.get(name);
    if (cached) return cached;
    const schema = this.definitions.get(SCHEMA_BASE + name);
    if (this.compiled && schema && /^[a-z0-9-]+\.schema\.json$/.test(name)) {
      try {
        const path = new URL(`${this.compiled.hash.slice(0, 16)}-${name}.cjs`, this.compiled.directory);
        const fn = requireValidator(fileURLToPath(path)) as ValidateFunction;
        fn.schema = schema;
        this.builtins.set(name, fn);
        return fn;
      } catch {
        /* Missing build output falls back to full validation, never to accepting data. */
      }
    }
    const fn = this.ajv.getSchema(SCHEMA_BASE + name);
    if (!fn) throw new Error(`未知 schema：${name}`);
    return fn;
  }

  /**
   * 解析 module.json 中 records.*.schema：先找模块目录下的自定义文件，再找内置。
   * 自定义 schema 挂在同一个 base URI 下，所以可以直接 $ref "record-base.schema.json"。
   */
  forModule(moduleId: string, moduleDirAbs: string, ref: string): ValidateFunction {
    const custom = resolve(moduleDirAbs, ref);
    const confined = (base: string, path: string) => {
      const rel = relative(base, path);
      if (
        isAbsolute(rel) ||
        rel === ".." ||
        rel.startsWith(`..${sep}`) ||
        rel.split(sep).some((part) => part === ".kaitu" || part === ".git")
      )
        throw new Error("schema 路径超出模块目录");
    };
    confined(moduleDirAbs, custom);
    if (existsSync(custom)) {
      confined(realpathSync(moduleDirAbs), realpathSync(custom));
      const key = custom;
      let fn: ValidateFunction | undefined = this.cache.get(key);
      if (!fn) {
        if (isICloudPath(dirname(moduleDirAbs))) assertCloudDownloaded(custom);
        const schema = JSON.parse(readFileSync(custom, "utf8"));
        const base = ref.split("/").pop() ?? ref;
        schema.$id = `${SCHEMA_BASE}${moduleId}-${createHash("sha256").update(custom).digest("hex")}--${base}`;
        fn = this.ajv.compile(schema);
        this.cache.set(key, fn);
      }
      return fn;
    }
    const name = ref.split("/").pop() ?? ref;
    if (this.hasBuiltin(name)) return this.builtin(name);
    throw new Error(`找不到 schema：${ref}`);
  }
}

export function formatErrors(errors: ErrorObject[] | null | undefined): SchemaIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message:
      e.keyword === "required"
        ? `缺少字段 ${(e.params as { missingProperty: string }).missingProperty}`
        : e.keyword === "additionalProperties"
          ? `多余字段 ${(e.params as { additionalProperty: string }).additionalProperty}`
          : e.keyword === "enum"
            ? `只能是 ${(e.params as { allowedValues: unknown[] }).allowedValues.join("、")}`
            : `${e.message ?? e.keyword}`,
  }));
}

let shared: SchemaRegistry | undefined;
export function schemas(): SchemaRegistry {
  shared ??= new SchemaRegistry();
  return shared;
}
