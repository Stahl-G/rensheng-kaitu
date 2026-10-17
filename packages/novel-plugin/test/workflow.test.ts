import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Fact,
  type Proposal,
  type Scene,
  type ScienceInput,
  type WorldRule,
  applyNovelDraft,
  connectNovel,
  convertNovelUnit,
  countNovelText,
  createProject,
  editNovel,
  importWorldbook,
  initWorkspace,
  novelFile,
  novelScene,
  novelScienceReference,
  novelTimeCheck,
  novelView,
  proposeNovelFact,
  recordScienceNote,
  reviewScienceFinding,
  runScienceCheck,
  saveNovelDraft,
  saveScienceRule,
  scienceView,
} from "@kaitu/core";
import { describe, expect, it } from "vitest";
import { hash } from "../../core/src/novel/store.js";

async function fixture(mode: "files" | "headings" = "files") {
  const dir = fs.mkdtempSync(join(tmpdir(), "kaitu-novel-test-"));
  const source = join(dir, "正文");
  fs.mkdirSync(join(source, "私密"), { recursive: true });
  fs.writeFileSync(
    join(source, "第一章.md"),
    "---\nprivate: metadata\n---\n# 观测站\n小球从静止释放，落下十米，耗时一秒。\n## 交接\n林舟在实验室记录结果。\n",
  );
  fs.writeFileSync(
    join(source, "规则.md"),
    "# 实验室规则\n实验室地面参考系，恒定重力 1.6 m/s^2。忽略阻力与额外作用力。\n",
  );
  fs.writeFileSync(join(source, "私密/不索引.md"), "私密\n");
  fs.writeFileSync(join(source, "bad.md"), Buffer.from([0xff, 0xfe, 0x00]));
  const outside = join(dir, "外部.md");
  fs.writeFileSync(outside, "不得读取外部笔记");
  fs.symlinkSync(outside, join(source, "越界.md"));
  const ws = await initWorkspace(join(dir, "workspace"), { timeZone: "UTC" });
  const { slug: project } = await createProject(ws, {
    title: "合成小说",
    kind: "personal",
    local_only: true,
    links: [{ path: source, role: "manuscript" }],
  });
  const options = { project, sourceRoot: source, mode, exclude: ["私密/**"] };
  return { ws, project, source, options, dir };
}
const fingerprints = (root: string) =>
  Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => {
        const path = join(f.parentPath, f.name);
        const s = fs.statSync(path);
        return [path, { hash: hash(fs.readFileSync(path)), mtime: s.mtimeMs }];
      }),
  );

describe("轻量小说插件真实文件闭环", () => {
  it("预览只读、恢复作品、批准撤销、陈旧来源和并发冲突", async () => {
    const f = await fixture("headings");
    const { ws, project, source, options } = f;
    const original = fingerprints(source);
    const preview = connectNovel(ws, { ...options, preview: true });
    expect(preview.scenes.length).toBe(3);
    expect(fs.existsSync(novelFile(ws, project))).toBe(false);
    expect(preview.issues.some((i) => i.includes("越界.md"))).toBe(true);
    expect(preview.issues.some((i) => i.includes("bad.md"))).toBe(true);
    connectNovel(ws, { ...options, preview: false });
    let v = novelView(ws, project);
    const scene = v.data.scenes[0] as Scene;
    editNovel(ws, project, v.revision, {
      type: "scene",
      id: scene.id,
      status: "draft",
      order: 12,
      worldTime: null,
    });
    expect(() => editNovel(ws, project, v.revision, { type: "pin", value: false })).toThrow(/资料已变化/);
    v = novelView(ws, project);
    editNovel(ws, project, v.revision, {
      type: "session",
      scene: scene.id,
      completed: "记录实验条件",
      next: "核对落体时间",
    });
    const sourceView = novelScene(ws, project, scene.id);
    expect(novelScene(ws, project, scene.title).scene.id).toBe(scene.id);
    const fact: Fact = {
      id: "lin",
      name: "林舟",
      kind: "person",
      text: "在实验室工作",
      canon: "tentative",
      sources: [sourceView.anchor],
    };
    v = novelView(ws, project);
    proposeNovelFact(ws, project, v.revision, fact, "agent");
    v = novelView(ws, project);
    expect(v.data.facts).toEqual([]);
    editNovel(ws, project, v.revision, {
      type: "decide",
      ids: [v.data.proposals[0]?.id],
      decision: "approve",
    });
    v = novelView(ws, project);
    expect(v.data.facts[0]?.text).toBe(fact.text);
    editNovel(ws, project, v.revision, { type: "decide", ids: [v.data.proposals[0]?.id], decision: "undo" });
    v = novelView(ws, project);
    expect(v.data.facts).toEqual([]);
    expect(v.data.sessions.at(-1)?.next).toBe("核对落体时间");
    expect(fingerprints(source)).toEqual(original);
    // A real external edit without incrementing a revision is still detected by file bytes.
    const revision = v.revision;
    fs.appendFileSync(novelFile(ws, project), "\n");
    expect(() => editNovel(ws, project, revision, { type: "pin", value: false })).toThrow(/资料已变化/);
    v = novelView(ws, project);
    proposeNovelFact(ws, project, v.revision, fact, "agent");
    const pending = novelView(ws, project).data.proposals.at(-1) as Proposal;
    fs.appendFileSync(join(source, scene.path), "\n作者在编辑器新增内容。\n");
    const externallyChanged = fingerprints(source);
    v = novelView(ws, project);
    expect(v.staleProposals).toContain(pending.id);
    expect(() =>
      editNovel(ws, project, v.revision, { type: "decide", ids: [pending.id], decision: "approve" }),
    ).toThrow(/陈旧/);
    expect(fingerprints(source)).toEqual(externallyChanged);
    // Rename a whole document: preserve the document and its scene identity.
    fs.renameSync(join(source, scene.path), join(source, "重命名.md"));
    v = novelView(ws, project);
    editNovel(ws, project, v.revision, { type: "refresh" });
    v = novelView(ws, project);
    expect(v.data.scenes.find((s) => s.id === scene.id)?.path).toBe("重命名.md");
    expect(v.data.scenes.find((s) => s.id === scene.id)?.worldTime).toBeNull();
    const draftInput = {
      title: "下一段",
      scene: scene.id,
      text: "窗外的影子慢慢转过观测站。",
      styleSources: [scene.id],
    };
    v = novelView(ws, project);
    expect(() => saveNovelDraft(ws, project, v.revision, draftInput)).toThrow(/只读模式/);
    editNovel(ws, project, v.revision, { type: "mode", mode: "writing" });
    v = novelView(ws, project);
    const draft = saveNovelDraft(ws, project, v.revision, draftInput);
    const beforeWriting = fs.readFileSync(join(source, "重命名.md"), "utf8");
    v = novelView(ws, project);
    applyNovelDraft(ws, project, v.revision, draft.id, "append");
    expect(fs.readFileSync(join(source, "重命名.md"), "utf8")).toContain(draftInput.text);
    v = novelView(ws, project);
    applyNovelDraft(ws, project, v.revision, draft.id, "undo");
    expect(fs.readFileSync(join(source, "重命名.md"), "utf8")).toBe(beforeWriting);
    expect(
      countNovelText(
        "---\nx: 9\n---\n# 中文 hello 123\n```js\nignored code\n```\n[链接](https://example.test)",
      ).words,
    ).toBe(6);
  });
  it("科幻条件、虚构例外、历史规则、失效依赖与本机计算", async () => {
    const { ws, project, source, options } = await fixture();
    connectNovel(ws, { ...options, preview: false });
    const originals = fingerprints(source);
    const v = novelView(ws, project);
    const scene = v.data.scenes.find((s) => s.path === "第一章.md") as Scene;
    const ruleScene = v.data.scenes.find((s) => s.path === "规则.md") as Scene;
    const rule: WorldRule = {
      id: "gravity",
      version: 1,
      title: "实验室重力",
      statement: "恒定重力 1.6 m/s^2",
      kind: "gravity",
      canon: "confirmed",
      location: "lab",
      frame: "floor",
      from: null,
      to: null,
      g: { value: 1.6, unit: "m/s^2" },
      exceptions: [],
      sources: [novelScene(ws, project, ruleScene.id).anchor],
      reason: "作者确认合成参数",
    };
    saveScienceRule(ws, project, scienceView(ws, project).revision, rule);
    const input: ScienceInput = {
      scene: scene.id,
      rule: rule.id,
      version: 1,
      location: "lab",
      frame: "floor",
      worldTime: "2042-01-01",
      height: { value: 10, unit: "m" },
      reportedTime: { value: 1, unit: "s" },
      toleranceSeconds: 0.1,
      fromRest: true,
      constantGravity: true,
      noDrag: true,
      noExtraForce: true,
      evidenceKind: "author_confirmed",
    };
    const run = (patch: Partial<ScienceInput> = {}) =>
      runScienceCheck(ws, project, scienceView(ws, project).revision, { ...input, ...patch });
    const conflict = run();
    expect(conflict.result.type).toBe("hard_rule_conflict");
    expect(conflict.result.calculation?.resultSeconds).toBeCloseTo(3.535533906, 8);
    expect(run({ reportedTime: { value: 3.54, unit: "s" } }).result.type).toBe("plausibility_note");
    for (const patch of [
      { frame: "" },
      { noExtraForce: false },
      { height: { value: 10, unit: "" } },
      { height: null },
      { height: { value: -1, unit: "m" } },
      { worldTime: null, location: "" },
    ])
      expect(run(patch).result.type).toBe("information_missing");
    for (const evidenceKind of ["character_claim", "metaphor", "dream", "narration"] as const)
      expect(run({ evidenceKind }).result.type).toBe("information_missing");
    saveScienceRule(ws, project, scienceView(ws, project).revision, {
      ...rule,
      version: 2,
      from: "2041-01-01",
      exceptions: [
        {
          id: "antigravity",
          statement: "作者确认悬浮场",
          location: "lab",
          from: null,
          to: null,
          canon: "confirmed",
        },
      ],
      reason: "未来时期启用悬浮场",
    });
    expect(scienceView(ws, project).stale).toContain(conflict.id);
    expect(run({ version: 2, worldTime: "2042-01-01" }).result.type).toBe("plausibility_note");
    expect(run({ version: 2, worldTime: "2040-01-01" }).result.type).toBe("information_missing");
    // Historical v1 still applies at its historical date.
    expect(run({ version: 1, worldTime: "2040-01-01" }).result.type).toBe("hard_rule_conflict");
    saveScienceRule(ws, project, scienceView(ws, project).revision, {
      ...rule,
      version: 3,
      kind: "fictional",
      g: null,
      statement: "作者确认可变重力技术",
      reason: "接受虚构前提",
    });
    expect(run({ version: 3 }).result.type).toBe("plausibility_note");
    const sfRevision = scienceView(ws, project).revision;
    reviewScienceFinding(ws, project, sfRevision, {
      id: conflict.id,
      status: "deferred",
      note: "作者稍后复核",
    });
    expect(() =>
      reviewScienceFinding(ws, project, sfRevision, { id: conflict.id, status: "confirmed", note: "" }),
    ).toThrow(/资料已变化/);
    expect(convertNovelUnit(1, "km", "m")).toMatchObject({ type: "calculated", value: 1000 });
    expect(convertNovelUnit(36, "km/h", "m/s")).toMatchObject({ type: "calculated", value: 10 });
    expect(convertNovelUnit(10, "m", "s").type).toBe("hard_rule_conflict");
    expect(convertNovelUnit(1, "parsec", "m").type).toBe("information_missing");
    expect(novelTimeCheck({ birth: "2000-12-31", at: "2020-12-30" })).toMatchObject({ age: 19 });
    expect(novelTimeCheck({ before: "2024-02-28", after: "2024-03-01" })).toMatchObject({ days: 2 });
    expect(novelTimeCheck({ before: "2040-02-01", after: "2040-01-01" }).type).toBe("hard_rule_conflict");
    expect(novelTimeCheck({ before: "day_1", after: "day_2" }).type).toBe("information_missing");
    expect(novelScienceReference("moon_gravity")).toMatchObject({
      reference: { value: 1.62, kind: "scientific_reference" },
    });
    const imported = importWorldbook(ws, project, scienceView(ws, project).revision, ruleScene.documentId);
    expect(imported.imported).toBe(1);
    expect(
      importWorldbook(ws, project, scienceView(ws, project).revision, ruleScene.documentId).unchanged,
    ).toBe(1);
    const note = recordScienceNote(ws, project, scienceView(ws, project).revision, {
      scene: scene.id,
      relatedScenes: [ruleScene.id],
      type: "plausibility_note",
      conclusion: "世界书的月面动作设定可直接对照",
      useMoonReference: true,
    });
    expect(
      scienceView(ws, project).data.findings.find((f) => f.id === note.id)?.result.references?.[0]?.url,
    ).toContain("nasa.gov");
    expect(fingerprints(source)).toEqual(originals);
  });
});
