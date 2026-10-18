import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const base = mkdtempSync(join(tmpdir(), "kaitu-library-measure-"));
process.env.HOME = join(base, "home");
process.env.KAITU_APP_HOME = join(base, "app");
process.env.KAITU_LOCAL_STATE_DIR = join(base, "state");
const core = await import("../packages/core/dist/index.js");
const { ulid } = await import("../packages/core/dist/ulid.js");
const { stringifyFrontmatter } = await import("../packages/core/dist/frontmatter.js");
const now = new Date("2026-10-19T08:00:00Z");
try {
  const ws = await core.initWorkspace(join(base, "workspace"), { now });
  const put = (path, text) => {
    const file = join(ws.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    const stable = new Date(Date.now() - 10000);
    utimesSync(file, stable, stable);
  };
  for (let i = 0; i < 60; i++)
    put(
      `projects/synthetic-${i}/STATUS.md`,
      stringifyFrontmatter(
        {
          title: `合成项目 ${i}`,
          kind: "work",
          stage: "active",
          updated: now.toISOString(),
          links: [],
          next: [{ id: `next-${i}`, title: `推进合成项目 ${i}`, status: "todo" }],
        },
        "合成项目正文",
      ),
    );
  for (let i = 0; i < 6000; i++)
    put(
      `inbox/notes/2026-10-18/synthetic-${i}.md`,
      stringifyFrontmatter(
        {
          agent: "你",
          date: "2026-10-18",
          kind: "capture",
        },
        `合成原文 ${i}\n${"只用于性能测量的合成正文。".repeat(100)}`,
      ),
    );
  put(
    "health/data/workouts/2026-10.jsonl",
    `${Array.from({ length: 5000 }, (_, i) =>
      JSON.stringify({
        id: ulid(),
        ts: "2026-10-18T08:00:00+08:00",
        by: "user",
        exercise: "合成深蹲",
        sets: 3,
        reps: 10,
        weight_kg: 30,
        session_id: `session-${i % 7}`,
      }),
    ).join("\n")}\n`,
  );
  for (let i = 0; i < 300; i++)
    put(
      `memory/synthetic-${i}.md`,
      stringifyFrontmatter(
        {
          type: "preference",
          name: `合成记忆 ${i}`,
          created: now.toISOString().slice(0, 10),
          updated: now.toISOString().slice(0, 10),
          sensitive: false,
        },
        "合成偏好正文。",
      ),
    );
  const counts = {
    projects: core.listProjects(ws).length,
    notes: core.inboxNotes(ws).length,
    workouts: core.readRecords(ws, "workout").length,
    memories: core.listMemories(ws).length,
  };
  if (JSON.stringify(counts) !== JSON.stringify({ projects: 60, notes: 6000, workouts: 5000, memories: 300 }))
    throw new Error(`Fixture mismatch: ${JSON.stringify(counts)}`);
  const data = await core.readOverviewPage(ws, now);
  const reader = new core.Workspace(ws.root, { maintain: false });
  const measure = () => {
    const start = performance.now();
    const library = core.buildPhoneLibrary(reader, data, now.toISOString());
    const ms = performance.now() - start;
    const validate = core.schemas().builtin("phone-library.schema.json");
    if (!validate(library)) throw new Error(JSON.stringify(validate.errors));
    return { ms, items: library.items.length };
  };
  const cold = measure();
  const warm = Array.from({ length: 5 }, measure);
  const start = performance.now();
  await core.writePhoneSnapshots(reader, now, { force: true });
  const allSnapshotsMs = performance.now() - start;
  const settingsStart = performance.now();
  for (let i = 0; i < 50; i++) await core.readSettings(reader);
  const settingsMeanMs = (performance.now() - settingsStart) / 50;
  console.log(
    JSON.stringify(
      { counts, cold, warm, allSnapshotsMs, settingsMeanMs, files: readdirSync(ws.root).length },
      null,
      2,
    ),
  );
} finally {
  rmSync(base, { recursive: true, force: true });
}
