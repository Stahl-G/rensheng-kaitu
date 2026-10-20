import { addProtocol } from "maplibre-gl";
import { afterEach, expect, it, vi } from "vitest";
import { registerPaperTiles } from "../src/client/paper-tiles-protocol.js";

vi.mock("maplibre-gl", () => ({ addProtocol: vi.fn() }));
registerPaperTiles();
const registration = vi.mocked(addProtocol).mock.calls[0];
if (!registration) throw new Error("Paper tile protocol was not registered");
const load = registration[1];
afterEach(() => vi.unstubAllGlobals());

it("离线时直接返回随包浅深主题 JPEG，不请求瓦片服务器", async () => {
  const fetch = vi.fn(() => Promise.reject(new Error("offline")));
  vi.stubGlobal("fetch", fetch);
  for (const theme of ["light", "dark"]) {
    const { data } = await load({ url: `kaitu-paper://${theme}/0/0/0` }, new AbortController());
    const bytes = new Uint8Array(data);
    expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9]);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("本地瓦片缺失时报告失败，不静默换成网络底图", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(load({ url: "kaitu-paper://light/3/99/99" }, new AbortController())).rejects.toThrow(
    "Local paper tile unavailable",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("切换主题或镜头取消的瓦片请求保留 AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(load({ url: "kaitu-paper://dark/0/0/0" }, controller)).rejects.toMatchObject({
    name: "AbortError",
  });
});
