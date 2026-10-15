export interface CsvRow {
  line: number;
  cells: string[];
}
/** RFC 4180 的小型状态机，保留物理行号（包括引号内换行）。 */
export function parseFinanceCsv(text: string) {
  const rows: CsvRow[] = [];
  const errors: { line: number; reason: string }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let invalid = false;
  let line = 1;
  let start = 1;
  const finish = () => {
    cells.push(field.trim());
    if (!invalid && cells.some(Boolean)) rows.push({ line: start, cells });
    cells = [];
    field = "";
    invalid = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.trim() === "") quoted = !quoted;
      else if (!invalid) {
        errors.push({ line: start, reason: "引号位置无效" });
        invalid = true;
      }
    } else if (c === "," && !quoted) {
      cells.push(field.trim());
      field = "";
    } else if ((c === "\r" || c === "\n") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish();
      line++;
      start = line;
    } else {
      field += c;
      if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
    }
  }
  if (quoted) errors.push({ line: start, reason: "引号未闭合" });
  else finish();
  return { rows, errors };
}
