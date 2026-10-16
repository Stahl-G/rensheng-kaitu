import { join } from "node:path";
import { KaituError } from "./errors.js";
import { isExperienceControlType } from "./experience-imports.js";
import { findRecordType, listRecordTypes } from "./modules.js";
import { schemas } from "./schema.js";
import type { Workspace } from "./workspace.js";

interface Schema {
  $id?: string;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  allOf?: Schema[];
  if?: Schema;
  then?: Schema;
  else?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  examples?: unknown[];
  items?: Schema;
  [key: string]: unknown;
}

function expand(schema: Schema, base: string): Schema {
  const uri = schema.$id ?? base;
  const parts = [...(schema.allOf ?? [])];
  if (schema.$ref) {
    const ref = new URL(schema.$ref, uri).href;
    parts.unshift(schemas().resolveSchema(ref) as Schema);
  }
  const out = { ...schema, properties: { ...schema.properties }, required: [...(schema.required ?? [])] };
  for (const part of parts) {
    const inherited = expand(part, uri);
    Object.assign(out, { ...inherited, ...out });
    out.properties = { ...inherited.properties, ...out.properties };
    out.required = [...new Set([...(inherited.required ?? []), ...out.required])];
  }
  out.$ref = undefined;
  out.allOf = undefined;
  for (const [name, field] of Object.entries(out.properties)) out.properties[name] = expand(field, uri);
  if (out.items) out.items = expand(out.items, uri);
  for (const key of ["anyOf", "oneOf"] as const) {
    if (out[key]) out[key] = out[key].map((part) => expand(part, uri));
  }
  return out;
}

function exampleValue(schema: Schema): unknown {
  if (schema.examples?.length) return schema.examples[0];
  if ("const" in schema) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (variant) return exampleValue({ ...schema, oneOf: undefined, anyOf: undefined, ...variant });
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || (Object.keys(schema.properties ?? {}).length > 0 && !type)) {
    return Object.fromEntries(
      (schema.required ?? []).map((name) => [name, exampleValue(schema.properties?.[name] ?? {})]),
    );
  }
  if (type === "array")
    return Array.from({ length: Number(schema.minItems ?? 0) }, () => exampleValue(schema.items ?? {}));
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (type === "number" || type === "integer") {
    const step = Number(schema.multipleOf ?? (type === "integer" ? 1 : 0.5));
    const min = Number(
      schema.minimum ?? (schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + step : 0),
    );
    const max = Number(
      schema.maximum ??
        (schema.exclusiveMaximum !== undefined
          ? Number(schema.exclusiveMaximum) - step
          : Number.POSITIVE_INFINITY),
    );
    return Math.min(Math.ceil(min / step) * step, Math.floor(max / step) * step);
  }
  if (schema.format === "date") return "2026-10-15";
  if (schema.format === "date-time") return "2026-10-15T12:00:00+08:00";
  const value = "example".repeat(Math.ceil(Number(schema.minLength ?? 1) / 7));
  return value.slice(0, Number(schema.maxLength ?? value.length));
}

function describe(schema: Schema): string {
  const variants = schema.oneOf ?? schema.anyOf;
  const type =
    schema.type ??
    (schema.enum ? typeof schema.enum[0] : Object.keys(schema.properties ?? {}).length ? "object" : "任意");
  const parts = [Array.isArray(type) ? type.join(" / ") : type];
  if (variants) parts.push(variants.map(describe).join(" / "));
  if (schema.enum) parts.push(`枚举 ${schema.enum.map((v) => JSON.stringify(v)).join(" / ")}`);
  if ("const" in schema) parts.push(`固定 ${JSON.stringify(schema.const)}`);
  for (const key of [
    "format",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "uniqueItems",
    "unit",
  ]) {
    if (schema[key] !== undefined) parts.push(`${key}=${schema[key]}`);
  }
  if (schema.items) parts.push(`元素 ${describe(schema.items)}`);
  if (schema.properties && Object.keys(schema.properties).length) {
    parts.push(
      `{${Object.entries(schema.properties)
        .map(([name, field]) => `${name}${schema.required?.includes(name) ? "*" : "?"}: ${describe(field)}`)
        .join(", ")}}`,
    );
  }
  if (schema.description) parts.push(schema.description);
  return parts.join("，");
}

const GENERATED = new Set(["id", "ts", "by", "rev", "deleted"]);

export function recordReference(ws: Workspace, type: string) {
  const ref = findRecordType(ws, type);
  const validator = schemas().forModule(ref.module.def.id, join(ws.root, ref.module.dir), ref.def.schema);
  const raw = validator.schema as Schema;
  const schema = expand(raw, raw.$id ?? "https://kaitu.local/schemas/");
  const fields = Object.entries(schema.properties ?? {}).filter(([name]) => !GENERATED.has(name));
  const required = fields.filter(([name]) => schema.required?.includes(name));
  const optional = fields.filter(([name]) => !schema.required?.includes(name));
  const managed = isExperienceControlType(type);
  const examples = (managed ? [] : schema.examples?.length ? schema.examples : [{}]).map((value) => {
    const supplied = value as Record<string, unknown>;
    return {
      type,
      ...Object.fromEntries(required.map(([name, field]) => [name, supplied[name] ?? exampleValue(field)])),
      ...Object.fromEntries(Object.entries(supplied).filter(([name]) => !GENERATED.has(name))),
    };
  });
  return {
    type,
    label: ref.def.label ?? schema.title ?? type,
    module: ref.module.dir,
    moduleLabel: ref.module.def.name,
    required: required.map(([name, field]) => ({ name, constraints: describe(field) })),
    optional: optional.map(([name, field]) => ({ name, constraints: describe(field) })),
    description: schema.description,
    writeVia: managed ? "由开图维护，用户在足迹的来源与导入中操作" : undefined,
    conditionalRequired: schema.if
      ? {
          when: describe(schema.if),
          requiredWhen: schema.then?.required ?? [],
          requiredOtherwise: schema.else?.required ?? [],
        }
      : undefined,
    example: managed ? undefined : (examples[0] ?? { type }),
    examples,
  };
}

export function recordReferences(ws: Workspace) {
  return listRecordTypes(ws).map(({ type }) => recordReference(ws, type));
}

export function recordTypeSummary(ws: Workspace): string {
  return listRecordTypes(ws)
    .map(({ type, def, module }) => `${type}：${def.label ?? type}（${module.def.name}）`)
    .join("\n");
}

export const RECORD_COMMON =
  "id、by、rev 由开图生成，不要写。ts 可省略（开图生成当前时间）；时间用 ts（ISO 8601，带时区偏移），只知道日期时可以给 date: YYYY-MM-DD，按用户时区当天 12:00 记录。类型自身定义的 date 字段保留。";

export function renderRecordReference(ws: Workspace, type?: string): string {
  const refs = type
    ? [recordReference(ws, type)]
    : listRecordTypes(ws).map(({ type }) => {
        try {
          return recordReference(ws, type);
        } catch {
          // Agent 可能分两步写 module.json 与 schema，中间仍可刷新其他类型。
          return type;
        }
      });
  const fieldLine = (fields: { name: string; constraints: string }[]) =>
    fields.map(({ name, constraints }) => `${name}（${constraints}）`).join("；") || "无";
  return [
    RECORD_COMMON,
    "source 若为该类型字段，省略时取本文件的 agent，未给 agent 则为 cloud-agent；不会自动改名其他字段。",
    ...refs.map((ref) =>
      typeof ref === "string"
        ? `### ${ref}\nSchema 尚未可用；用 kaitu record schema ${ref} 查看原因。`
        : [
            `### ${ref.type} · ${ref.label}（${ref.moduleLabel} / ${ref.module}）`,
            ref.description,
            ref.writeVia,
            `固定必填：${fieldLine(ref.required)}。其他字段：${fieldLine(ref.optional)}。`,
            ref.conditionalRequired &&
              `条件必填：当 ${ref.conditionalRequired.when} 时 ${ref.conditionalRequired.requiredWhen.join("、")}；否则 ${ref.conditionalRequired.requiredOtherwise.join("、")}。`,
            ...ref.examples.map((example) => `示例 JSONL：\`${JSON.stringify(example)}\``),
          ]
            .filter(Boolean)
            .join("\n"),
    ),
  ].join("\n\n");
}

export function recordRejectionHelp(ws: Workspace, type: unknown): string {
  try {
    if (typeof type === "string") return renderRecordReference(ws, type);
  } catch (error) {
    if (!(error instanceof KaituError) || error.code !== "UNKNOWN_TYPE") throw error;
  }
  return JSON.stringify(
    {
      record_types: listRecordTypes(ws).map(({ type, def, module }) => ({
        type,
        label: def.label ?? type,
        module: module.dir,
      })),
    },
    null,
    2,
  );
}
