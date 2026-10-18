import { parse, stringify } from "yaml";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface Frontmatter<T = Record<string, unknown>> {
  data: T;
  body: string;
}

export function hasFrontmatter(text: string): boolean {
  return FM.test(text);
}

export function parseFrontmatter<T = Record<string, unknown>>(text: string): Frontmatter<T> {
  const m = FM.exec(text);
  if (!m) return { data: {} as T, body: text };
  const data = parse(m[1] ?? "") ?? {};
  return { data: data as T, body: m[2] ?? "" };
}

/** 只取正文，不解析 YAML：写坏的 frontmatter 也不会抛错。 */
export function frontmatterBody(text: string): string {
  return FM.exec(text)?.[2] ?? text;
}

export function stringifyFrontmatter(data: unknown, body = ""): string {
  return `---\n${stringify(data).trimEnd()}\n---\n${body}`;
}
