import type { FileImportSource } from "@kaitu/core";

/** Only inspect leading scalar fields; nested, reordered or incomplete headers need a user choice. */
export async function jsonImportSource(file: Blob): Promise<"nut-ai" | "chatgpt-conversations" | "choose"> {
  let head = (await file.slice(0, 65536).text()).trimStart();
  const array = head.startsWith("[");
  if (array) head = head.slice(1).trimStart();
  if (!head.startsWith("{")) return "choose";
  head = head.slice(1).trimStart();
  while (head) {
    const field = /^"([^"\\]+)"\s*:\s*/.exec(head);
    if (!field) break;
    head = head.slice(field[0].length);
    if (array && field[1] === "mapping" && head.startsWith("{")) return "chatgpt-conversations";
    const scalar = /^("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*([,}])\s*/.exec(
      head,
    );
    if (!scalar) break;
    if (!array && field[1] === "format" && scalar[1] === '"nutai.backup"') return "nut-ai";
    if (scalar[2] !== ",") break;
    head = head.slice(scalar[0].length);
  }
  return "choose";
}

/** Read only the ZIP directory. Payloads and embedded archives cannot identify the outer export. */
export async function zipImportSource(
  file: Blob,
): Promise<"apple-health" | "chatgpt-conversations" | "choose"> {
  // The end record is 22 bytes plus an optional comment of at most 65535 bytes.
  const tail = new DataView(await file.slice(-65557).arrayBuffer());
  for (let end = tail.byteLength - 22; end >= 0; end--) {
    if (
      tail.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength
    )
      continue;
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    if (size > 2 * 1024 * 1024 || offset + size !== file.size - tail.byteLength + end) return "choose";
    const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
    const directory = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    let health = false;
    let chat = false;
    for (let pos = 0; pos < size; ) {
      if (pos + 46 > size || directory.getUint32(pos, true) !== 0x02014b50) return "choose";
      const nameEnd = pos + 46 + directory.getUint16(pos + 28, true);
      const next = nameEnd + directory.getUint16(pos + 30, true) + directory.getUint16(pos + 32, true);
      if (next > size) return "choose";
      const name = decoder.decode(bytes.subarray(pos + 46, nameEnd));
      health ||= name === "apple_health_export/export.xml";
      chat ||= name.split("/").at(-1) === "conversations.json";
      pos = next;
    }
    if (health !== chat) return health ? "apple-health" : "chatgpt-conversations";
    break;
  }
  return "choose";
}

export async function detectFileImportSource(file: File): Promise<FileImportSource | "choose"> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "ics") return "ics";
  if (extension === "xml") return "apple-health";
  if (extension === "json") return jsonImportSource(file);
  if (extension === "zip") return zipImportSource(file);
  return "choose";
}

export function normalizeGithubRepo(input: string): string {
  const trimmed = input.trim();
  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(trimmed);
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : trimmed;
}
