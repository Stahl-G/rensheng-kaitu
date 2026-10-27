import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { ResumeImport, type ResumeServices } from "../src/client/ResumeImport.js";
import css from "../src/client/WorkPage.module.css";

it("抽取成功而写入失败后保留结果，纠正重试只写入；换文件才开始新抽取", async () => {
  const original = '{"entries":[{"incorrect":"synthetic"}]}';
  const corrected = '{"entries":[{"kind":"worked","organization":"Example"}]}';
  const extract = vi.fn(async () => ({ answer: original, provider: "synthetic", model: "synthetic" }));
  const commit = vi.fn().mockRejectedValueOnce(new Error("invalid extraction")).mockResolvedValue({
    added: 1,
    duplicates: 0,
    pending: 0,
    excluded: 0,
    batch_id: "synthetic",
    version: null,
  });
  const props: ResumeServices & { onChanged: () => Promise<void> } = {
    uploadResume: async (name) => ({
      file: `synthetic/${name}`,
      name,
      mime: "application/pdf",
      pages: ["Synthetic text"],
    }),
    resumePrompt: async () => "synthetic prompt",
    extractResume: extract,
    importResume: commit,
    resumeConnection: async () => ({
      configured: true,
      provider: "synthetic",
      model: "synthetic",
      supportsImages: true,
    }),
    onChanged: vi.fn(async () => {}),
  };
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(ResumeImport, props));
    });
    const choose = async (name: string) =>
      act(async () => {
        root.root.findByType("input").props.onChange({
          target: { files: [new File(["synthetic"], name)] },
          currentTarget: { value: name },
        });
        await Promise.resolve();
      });
    await choose("first.pdf");
    await act(async () => {
      await root.root.findByProps({ className: css.primary }).props.onClick();
    });
    expect(extract).toHaveBeenCalledExactlyOnceWith("synthetic/first.pdf");
    expect(root.root.findByType("textarea").props.value).toBe(original);
    expect(root.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    await act(async () => {
      root.root.findByType("textarea").props.onChange({ target: { value: corrected } });
    });
    await act(async () => {
      await root.root.findByProps({ className: css.primary }).props.onClick();
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls.map(([file, answer]) => [file, answer])).toEqual([
      ["synthetic/first.pdf", original],
      ["synthetic/first.pdf", corrected],
    ]);
    expect(props.onChanged).toHaveBeenCalledOnce();
    expect(root.root.findAllByType("output")).toHaveLength(1);
    await choose("second.pdf");
    await act(async () => {
      await root.root.findByProps({ className: css.primary }).props.onClick();
    });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenLastCalledWith("synthetic/second.pdf");
  } finally {
    if (root) act(() => root.unmount());
  }
});
