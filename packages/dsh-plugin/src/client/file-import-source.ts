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
