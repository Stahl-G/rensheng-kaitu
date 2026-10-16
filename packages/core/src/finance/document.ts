import { Unzip, UnzipInflate } from "fflate";
import readXlsx from "read-excel-file/node";
import { readXls } from "xls-reader";
import { KaituError } from "../errors.js";
import { type CsvRow, parseFinanceCsv } from "./csv.js";
import { clean } from "./providers/shared.js";
import { detectFinanceTable, supportedFinanceSources } from "./providers/tables.js";

export async function readFinanceDocument(bytes: Buffer, sheet?: string) {
  if (bytes.length > 32 * 1024 * 1024) throw new KaituError("账单超过 32 MiB，请分批导入", "IMPORT_LIMIT");
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (zip) {
    let expanded = 0;
    let declared = 0;
    let entries = 0;
    const unzip = new Unzip((file) => {
      declared += file.originalSize ?? 0;
      if (++entries > 10000 || declared > 128 * 1024 * 1024)
        throw new KaituError("账单压缩包内容过大", "IMPORT_LIMIT");
      file.ondata = (error, data) => {
        if (error) throw error;
        expanded += data.byteLength;
        if (expanded > 128 * 1024 * 1024) throw new KaituError("账单解压内容过大", "IMPORT_LIMIT");
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 16384)
      unzip.push(bytes.subarray(offset, offset + 16384), offset + 16384 >= bytes.length);
  }
  if (zip || ole) {
    const sheets: ReadonlyArray<{ name: string; rows: ReadonlyArray<ReadonlyArray<unknown>> }> = zip
      ? (await readXlsx(bytes, { parseNumber: (value) => value })).map((s) => ({
          name: s.sheet,
          rows: s.data,
        }))
      : readXls(bytes).sheets;
    const tables = sheets
      .map((s) => ({
        name: s.name,
        rows: s.rows.map((row, index) => ({
          line: index + 1,
          cells: Array.from(row, (value) =>
            value instanceof Date
              ? value.toISOString().slice(0, 19)
              : value === null || value === undefined
                ? ""
                : String(value),
          ),
        })),
      }))
      .filter((s) => {
        if (sheet) return s.name === sheet;
        try {
          detectFinanceTable(s.rows);
          return true;
        } catch {
          return false;
        }
      });
    if (tables.length === 0)
      throw new KaituError(
        `未找到指定或可识别的工作表。可识别：${supportedFinanceSources.join("、")}`,
        "INVALID_IMPORT",
      );
    if (tables.length !== 1)
      throw new KaituError(
        `请选择一个可识别的工作表（sheet）：${sheets.map((s) => s.name).join("、")}`,
        "INVALID_IMPORT",
      );
    return {
      rows: tables[0]?.rows ?? [],
      errors: [],
      text: "",
      encoding: zip ? "xlsx" : "xls",
      sheet: tables[0]?.name ?? null,
    };
  }
  let text: string;
  let encoding = "utf-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gbk", { fatal: true }).decode(bytes);
    encoding = "gbk";
  }
  text = text.replace(/^\uFEFF/, "");
  // 华西的 .xls 实际为 GBK TSV，按表头行判定分隔符，不受正文金额中的逗号影响。
  const tabular = text
    .split(/\r?\n/)
    .some((line) => line.includes("\t") && /证券代码|交易时间|记账日/.test(line) && !line.includes(","));
  const parsed = tabular
    ? {
        rows: text
          .split(/\r?\n/)
          .map((line, i) => ({ line: i + 1, cells: line.split("\t").map(clean) }))
          .filter((r) => r.cells.some(Boolean)),
        errors: [],
      }
    : parseFinanceCsv(text.replace(/(^|,)="([^"\r\n]*)"/gm, '$1"$2"'));
  return { ...parsed, text, encoding, sheet: null } as {
    rows: CsvRow[];
    errors: { line: number; reason: string }[];
    text: string;
    encoding: string;
    sheet: string | null;
  };
}
