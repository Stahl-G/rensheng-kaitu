import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  changeExperienceBatch,
  editExperience,
  importResume,
  lifeMap,
  previewExperienceBatch,
  readExperienceSource,
  readMe,
  readRecordRevisions,
  uploadResume,
  validateWorkspace,
} from "../src/index.js";
import { clonedWorkspace } from "./helpers.js";

// Generated, fictional résumé text; no personal data or binary fixture in the repository.
function pdf(text: string) {
  const stream = `BT /F1 10 Tf 40 740 Td ${text
    .split("; ")
    .map((line, index) => `${index ? "0 -22 Td " : ""}(${line}) Tj`)
    .join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = value.length;
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value).toString("base64");
}
const rows = [
  {
    kind: "worked",
    organization: "Example Studio",
    role: "Engineer",
    start: "2020-06",
    evidence: "Example Studio Engineer 2020-06 Remote",
    page: 1,
    subject: "self",
    city: "Remote",
  },
  {
    kind: "worked",
    organization: "Other Studio",
    role: "Designer",
    start: "2020-06",
    evidence: "Other Studio Designer 2020-06 Remote",
    page: 1,
    subject: "self",
    city: "Remote",
  },
  {
    kind: "studied",
    organization: "Example University",
    role: "Physics",
    start: "2015",
    end: "2019",
    evidence: "Example University Physics 2015 2019",
    page: 1,
    subject: "self",
  },
];
const text = rows.map((item) => item.evidence).join("; ");

it("简历写进同一经历正本，保留页码；并行职位不合并，跨文件幂等，整批撤销与恢复往返", async () => {
  const ws = await clonedWorkspace();
  try {
    const upload = await uploadResume(ws, "fictional-resume.pdf", pdf(text));
    expect(upload.pages[0]).toContain("Example Studio");
    const result = await importResume(ws, upload.file, JSON.stringify({ entries: rows }));
    expect(result).toMatchObject({ added: 3, duplicates: 0, pending: 0 });
    const career = readMe(ws).career;
    expect(career).toHaveLength(3);
    expect(new Set(career.map((item) => item.title)).size).toBe(3);
    expect(career.find((item) => item.title.includes("Engineer"))?.end).toBeNull();
    const stored = lifeMap(ws).experiences.find((item) => item.title?.includes("Engineer"));
    expect(stored?.place).toMatchObject({ precision: "unknown" });
    expect(stored?.place.geonameid).toBeUndefined();
    const evidence = await readExperienceSource(ws, career[0]?.id ?? "");
    expect(evidence).toMatchObject({ kind: "attachment", page: 1, file: upload.file });
    const other = await uploadResume(ws, "second-source.pdf", pdf(`${text}; another source`));
    expect((await importResume(ws, other.file, JSON.stringify({ entries: rows }))).duplicates).toBe(3);
    const batch = previewExperienceBatch(ws, result.batch_id ?? "", "undo");
    await changeExperienceBatch(ws, batch.id, "undo", batch.revision);
    expect(readMe(ws).career).toHaveLength(0);
    expect((await importResume(ws, upload.file, JSON.stringify({ entries: rows }))).added).toBe(0);
    await changeExperienceBatch(ws, batch.id, "restore", 2);
    expect(readMe(ws).career).toHaveLength(3);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("损坏、无文字、伪造证据或页码不会写入；歧义不进入简历，修正后批次撤销保留用户修订", async () => {
  const ws = await clonedWorkspace();
  try {
    await expect(
      uploadResume(ws, "broken.pdf", Buffer.from("%PDF-broken").toString("base64")),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    await expect(uploadResume(ws, "blank.pdf", pdf(""))).rejects.toMatchObject({ code: "NO_TEXT" });
    const upload = await uploadResume(ws, "fictional.pdf", pdf(text));
    await expect(
      importResume(ws, upload.file, JSON.stringify({ entries: [{ ...rows[0], page: 2 }] })),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    await expect(
      importResume(
        ws,
        upload.file,
        JSON.stringify({ entries: [{ ...rows[0], organization: "Invented company" }] }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(readRecordRevisions(ws, "experience")).toHaveLength(0);
    const result = await importResume(
      ws,
      upload.file,
      JSON.stringify({ entries: [{ ...rows[0], subject: "uncertain" }] }),
    );
    expect(result.pending).toBe(1);
    expect(readMe(ws).career).toHaveLength(0);
    const item = lifeMap(ws).experiences[0];
    if (!item) throw new Error("Expected a pending experience");
    await editExperience(
      ws,
      item.id,
      { ...item, place: { name: "巴黎", country: "FR" }, fact_status: "user_reported" },
      1,
    );
    expect(readMe(ws).career).toHaveLength(1);
    const preview = previewExperienceBatch(ws, result.batch_id ?? "", "undo");
    expect(preview.preserved.map((row) => row.id)).toContain(item.id);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
