import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type ResumeEntry,
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

const datedRole = (start: string, end?: string, role = "Engineer"): ResumeEntry => ({
  kind: "worked",
  organization: "Temporal Studio",
  role,
  start,
  end,
  evidence: `Temporal Studio ${role} ${start}${end ? ` to ${end}` : ""}`,
  page: 1,
  subject: "self",
});
async function importRows(ws: Awaited<ReturnType<typeof clonedWorkspace>>, entries: ResumeEntry[]) {
  const source = await uploadResume(ws, "temporal.pdf", pdf(entries.map((row) => row.evidence).join("; ")));
  return importResume(ws, source.file, JSON.stringify({ entries }));
}

it("同组织职位的近邻开始月份留待核对，重复投递该冲突不会再写一条", async () => {
  const ws = await clonedWorkspace();
  try {
    await importRows(ws, [datedRole("2020-06")]);
    expect(await importRows(ws, [datedRole("2020-07")])).toMatchObject({ added: 1, pending: 1 });
    expect(readMe(ws).career).toHaveLength(1);
    expect(readRecordRevisions(ws, "experience").map((row) => row.fact_status)).toEqual([
      "user_reported",
      "suggested",
    ]);
    expect(await importRows(ws, [datedRole("2020-07")])).toMatchObject({ added: 0, duplicates: 1 });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it.each([
  [datedRole("2020-06", "2022-12"), datedRole("2021-04", "2023-01")],
  [datedRole("2020"), datedRole("2020-06")],
  [datedRole("2020-06"), datedRole("2020")],
])("同组织职位的时间重叠或不同精度包含不冒充两段确定经历 %#", async (prior, next) => {
  const ws = await clonedWorkspace();
  try {
    await importRows(ws, [prior]);
    expect(await importRows(ws, [next])).toMatchObject({ added: 1, pending: 1 });
    expect(readMe(ws).career).toHaveLength(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("明确分开的再入职独立保留；缺结束日期不补成无限重叠区间", async () => {
  const ws = await clonedWorkspace();
  try {
    for (const row of [
      datedRole("2020-06", "2020-06"),
      datedRole("2020-07", "2021-03"),
      datedRole("2023-04"),
      datedRole("2026-01", "2026-06"),
    ])
      expect(await importRows(ws, [row])).toMatchObject({ added: 1, pending: 0 });
    expect(readMe(ws).career).toHaveLength(4);
    expect(new Set(readMe(ws).career.map((row) => row.id)).size).toBe(4);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("同一组织并行不同职位和不同组织同职位不作为日期冲突或合并", async () => {
  const ws = await clonedWorkspace();
  try {
    const other = {
      ...datedRole("2020-06", "2022-06"),
      organization: "Another Studio",
      evidence: "Another Studio Engineer 2020-06 to 2022-06",
    };
    expect(
      await importRows(ws, [
        datedRole("2020-06", "2022-06"),
        datedRole("2020-06", "2022-06", "Designer"),
        other,
      ]),
    ).toMatchObject({ added: 3, pending: 0, duplicates: 0 });
    expect(readMe(ws).career).toHaveLength(3);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it.each(["Remote", undefined])(
  "导入 %s 后只改标题备注保留 unknown 地点，不产生地名核对；真正改城市才解析",
  async (city) => {
    const ws = await clonedWorkspace();
    try {
      await importRows(ws, [
        {
          ...datedRole("2020-06"),
          city,
          evidence: `Temporal Studio Engineer 2020-06${city ? ` ${city}` : ""}`,
        },
      ]);
      const initial = lifeMap(ws).experiences[0];
      if (!initial) throw new Error("Expected imported career");
      const changes = {
        place: { name: initial.place.name, country: initial.place.country },
        event_type: initial.event_type,
        fact_status: initial.fact_status,
        start: initial.start,
        time_precision: initial.time_precision,
        title: "Temporal Studio · Engineer (corrected)",
        notes: `${initial.notes}\nCorrected note`,
      };
      await editExperience(ws, initial.id, changes, 1);
      const edited = readRecordRevisions(ws, "experience").at(-1);
      expect(edited).toMatchObject({
        place: initial.place,
        title: changes.title,
        notes: changes.notes,
        rev: 2,
      });
      expect(edited?.review).toBeUndefined();
      expect(lifeMap(ws).experiences[0]?.review).toBeUndefined();
      await editExperience(ws, initial.id, { ...changes, place: { name: "Paris", country: "FR" } }, 2);
      expect(lifeMap(ws).experiences[0]?.place).toMatchObject({
        precision: "city",
        name: "Paris",
        country: "FR",
      });
      expect(validateWorkspace(ws)).toEqual([]);
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  },
);

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
