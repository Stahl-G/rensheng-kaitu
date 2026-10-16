import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import addFormatsModule from "ajv-formats";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { schemasDir } from "./assets.js";
import { assertCloudDownloaded } from "./sync-files.js";
import { isICloudPath } from "./sync-location.js";

// ajv-formats 是 CommonJS，NodeNext 下 default 导入拿到的是整个 exports 对象
const addFormats = addFormatsModule.default;

export const SCHEMA_BASE = "https://kaitu.local/schemas/";

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaRegistry {
  private ajv = new Ajv2020({ allErrors: true, strict: false });
  private cache = new Map<string, ValidateFunction>();

  constructor() {
    addFormats(this.ajv);
    const dir = schemasDir();
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".schema.json")) this.ajv.addSchema(JSON.parse(readFileSync(join(dir, f), "utf8")));
    }
  }

  resolveSchema(ref: string): unknown {
    const schema = this.ajv.getSchema(ref)?.schema;
    if (!schema) throw new Error(`找不到 schema：${ref}`);
    return schema;
  }

  hasBuiltin(name: string): boolean {
    return Boolean(this.ajv.getSchema(SCHEMA_BASE + name));
  }

  /** 内置 schema 用文件名（如 workout.schema.json）取。 */
  builtin(name: string): ValidateFunction {
    const fn = this.ajv.getSchema(SCHEMA_BASE + name);
    if (!fn) throw new Error(`未知 schema：${name}`);
    return fn;
  }

  /**
   * 解析 module.json 中 records.*.schema：先找模块目录下的自定义文件，再找内置。
   * 自定义 schema 挂在同一个 base URI 下，所以可以直接 $ref "record-base.schema.json"。
   */
  forModule(moduleId: string, moduleDirAbs: string, ref: string): ValidateFunction {
    const custom = join(moduleDirAbs, ref);
    if (existsSync(custom)) {
      const key = custom;
      let fn: ValidateFunction | undefined = this.cache.get(key);
      if (!fn) {
        if (isICloudPath(dirname(moduleDirAbs))) assertCloudDownloaded(custom);
        const schema = JSON.parse(readFileSync(custom, "utf8"));
        const base = ref.split("/").pop() ?? ref;
        schema.$id = `${SCHEMA_BASE}${moduleId}--${base}`;
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
          : `${e.message ?? e.keyword}`,
  }));
}

let shared: SchemaRegistry | undefined;
export function schemas(): SchemaRegistry {
  shared ??= new SchemaRegistry();
  return shared;
}
