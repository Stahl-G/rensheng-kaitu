import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { fetchCalendar } from "../src/calendar-fetch.js";

it("日历连接固定公开解析地址，各次跳转重新验证，压缩输入和解压输出均有上限", async () => {
  const requests: string[] = [];
  let redirect: string | undefined;
  let encoding: string | undefined;
  let payload = Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
  let answers = [{ address: "93.184.216.34", family: 4 }];
  const network = {
    lookup: async () => answers,
    request: async (url: URL, address: { address: string }, _signal: AbortSignal) => {
      requests.push(`${url.hostname}/${address.address}`);
      const location = redirect;
      redirect = undefined;
      return {
        status: location ? 302 : 200,
        location,
        encoding,
        body: (async function* () {
          yield payload;
        })(),
        close() {},
      };
    },
  };
  for (const address of [
    "file:///etc/passwd",
    "ftp://calendar.example/a",
    "http://127.2.3.4/a",
    "http://2130706433/a",
    "http://[::1]/a",
    "http://[::ffff:127.0.0.1]/a",
    "http://169.254.1.2/a",
  ]) {
    await expect(fetchCalendar(address, network)).rejects.toThrow();
  }
  expect(requests).toHaveLength(0);
  answers.push({ address: "10.0.0.1", family: 4 });
  await expect(fetchCalendar("https://calendar.example/a", network)).rejects.toThrow();
  expect(requests).toHaveLength(0);
  answers = answers.slice(0, 1);
  const original = Buffer.from(payload);
  answers = [{ address: "2606:4700:4700::1111", family: 6 }];
  expect(await fetchCalendar("https://calendar.example/v6", network)).toEqual(original);
  expect(requests.at(-1)).toBe("calendar.example/2606:4700:4700::1111");
  answers = [{ address: "93.184.216.34", family: 4 }];
  expect(await fetchCalendar("https://calendar.example/a", network)).toEqual(original);
  expect(requests.at(-1)).toBe("calendar.example/93.184.216.34");
  redirect = "http://[::1]/secret";
  const before = requests.length;
  await expect(fetchCalendar("https://calendar.example/a", network)).rejects.toThrow();
  expect(requests).toHaveLength(before + 1);
  redirect = "https://other.example/a";
  expect(await fetchCalendar("https://calendar.example/a", network)).toEqual(original);
  expect(requests.at(-1)).toBe("other.example/93.184.216.34");
  for (const [type, compress] of [
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const) {
    encoding = type;
    payload = compress(original);
    expect(await fetchCalendar("https://calendar.example/a", network)).toEqual(original);
    payload = compress(Buffer.alloc(10 * 1024 * 1024 + 1, "x"));
    await expect(fetchCalendar("https://calendar.example/a", network)).rejects.toThrow();
  }
  encoding = undefined;
  payload = Buffer.alloc(10 * 1024 * 1024 + 1);
  await expect(fetchCalendar("https://calendar.example/a", network)).rejects.toThrow();
  let redirects = 0;
  await expect(
    fetchCalendar("https://calendar.example/a", {
      ...network,
      request: async () => {
        redirects++;
        return { status: 302, location: "/again", body: (async function* () {})(), close() {} };
      },
    }),
  ).rejects.toThrow();
  expect(redirects).toBeLessThanOrEqual(4);
});
