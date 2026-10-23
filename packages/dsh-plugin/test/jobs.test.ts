import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { initWorkspace, readPreferences, savePreferences } from "@kaitu/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { productRequest } from "../../cli/src/ui/product.js";
import { TYPERT } from "../lib/typert.host.js";
import { ExploreModulesPage } from "../src/client/ExploreNavigation.js";
import { JobDetails } from "../src/client/JobsPage.js";
import { defaultExploreEntries } from "../src/client/explore-modules.js";
import { KaituOverviewService } from "../src/overview-service.js";

it("reads the existing source through Remote, keeps optional visibility and never writes source state", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-jobs-"));
  try {
    const ws = await initWorkspace(root);
    const service = new KaituOverviewService(new Context(), {}, ws);
    expect(await service.jobs()).toEqual({ available: false, items: [] });
    const rows = [
      {
        id: "example-1",
        title: "Synthetic PM",
        company: "Example",
        location: "Remote",
        date_found: "2026-10-20",
        posted: "Date not confirmed",
        source: "Example board",
        url: "https://example.com/jobs/1",
        salary: null,
        track: "Product",
        fit_note: "Source note",
        status: "applied",
        private_extra: "Preserved, not projected",
      },
    ];
    ws.writeJson("jobs/jobs.json", rows);
    const source = ws.readText("jobs/jobs.json");
    const old = new Date(Date.now() - 5000);
    utimesSync(ws.resolve("jobs/jobs.json"), old, old);
    const contract = TYPERT as {
      invocations: {
        namespace: string;
        method: string;
        result: { create(): { parse(value: unknown): unknown } };
      }[];
    };
    const codec = contract.invocations.find(
      (entry) => entry.namespace === "kaitu" && entry.method === "jobs",
    );
    expect(codec).toBeDefined();
    const data = JSON.parse(JSON.stringify(codec?.result.create().parse(await service.jobs())));
    expect(data.items).toEqual([
      expect.objectContaining({ title: "Synthetic PM", status: "applied", posted: "Date not confirmed" }),
    ]);
    expect(data.items[0]).not.toHaveProperty("salary");
    expect(data.items[0]).not.toHaveProperty("private_extra");
    expect(await productRequest(ws, "jobs", [])).toEqual(data);
    const prior = readPreferences();
    try {
      const visible = (entries: string[]) =>
        renderToStaticMarkup(
          createElement(ExploreModulesPage, {
            entries,
            current: "jobs",
            open: () => {},
            save: async (entries) => savePreferences({ exploreEntries: entries }),
          }),
        ).includes('aria-label="隐藏入口：求职"');
      expect(visible(prior.exploreEntries ?? [...defaultExploreEntries])).toBe(false);
      savePreferences({ exploreEntries: ["news", "jobs", "footprints"] });
      expect(visible(readPreferences().exploreEntries ?? [])).toBe(true);
      savePreferences({ exploreEntries: ["news", "footprints"] });
      expect(visible(readPreferences().exploreEntries ?? [])).toBe(false);
      expect(await service.jobs()).toEqual(data);
      savePreferences({ exploreEntries: [] });
      expect(readPreferences().exploreEntries).toEqual([]);
      savePreferences({ exploreEntries: [...defaultExploreEntries] });
      expect(visible(readPreferences().exploreEntries ?? [])).toBe(false);
      expect(readFileSync(ws.resolve("jobs/jobs.json"), "utf8")).toBe(source);
    } finally {
      savePreferences(prior);
    }
    ws.writeJson("jobs/jobs.json", [...rows, { title: "Later source", url: "https://example.com/jobs/2" }]);
    expect((await service.jobs()).items[1]).toEqual({
      title: "Later source",
      url: "https://example.com/jobs/2",
    });
    ws.writeText("jobs/jobs.json", "{broken");
    await expect(service.jobs()).rejects.toThrow("JSON");
    expect(ws.readText("jobs/jobs.json")).toBe("{broken");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("shows source details as text, only opens HTTP sources and leaves absent fields absent", () => {
  const html = renderToStaticMarkup(
    createElement(JobDetails, {
      item: {
        title: "<img src=x onerror=alert(1)>",
        posted: "Not verified",
        fit_note: "First line\nSecond line",
        url: "https://example.com/jobs/1",
      },
    }),
  );
  expect(html).toContain('<a href="https://example.com/jobs/1" target="_blank" rel="noreferrer">');
  expect(html).toContain("Not verified");
  expect(html).toContain("First line\nSecond line");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<dt>公司</dt>");
  const unsafe = renderToStaticMarkup(
    createElement(JobDetails, { item: { title: "Example", url: "javascript:alert(1)" } }),
  );
  expect(unsafe).not.toContain("<a ");
});
