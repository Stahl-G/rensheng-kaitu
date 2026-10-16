import { lookup as dnsLookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
function publicAddress(address: string): boolean {
  const local = new BlockList();
  for (const item of Object.values(networkInterfaces()).flat()) {
    if (item)
      local.addAddress(item.address.split("%")[0] as string, item.family === "IPv4" ? "ipv4" : "ipv6");
  }
  const family = isIP(address);
  if (family && local.check(address, family === 4 ? "ipv4" : "ipv6")) return false;
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
interface Address {
  address: string;
  family: number;
}
interface Response {
  status: number;
  location?: string;
  encoding?: string;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
interface Network {
  lookup(hostname: string): Promise<Address[]>;
  request(url: URL, address: Address, signal: AbortSignal): Promise<Response>;
}
const network: Network = {
  lookup: (hostname) => dnsLookup(hostname, { all: true }),
  request: (url, address, signal) =>
    new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsGet : httpGet)(
        url,
        {
          hostname: address.address,
          family: address.family,
          servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
          headers: { Host: url.host, "Accept-Encoding": "gzip, deflate, br" },
          agent: false,
          signal,
        },
        (response) =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            encoding: response.headers["content-encoding"],
            body: response,
            close: () => response.destroy(),
          }),
      );
      request.once("error", reject);
    }),
};
export async function fetchCalendar(address: string, transport: Network = network): Promise<Buffer> {
  let url = new URL(address);
  const signal = AbortSignal.timeout(20000);
  let bytes = 0;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("日历订阅仅支持 HTTP/HTTPS");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(hostname);
    signal.throwIfAborted();
    const addresses = family
      ? [{ address: hostname, family }]
      : await new Promise<Address[]>((resolve, reject) => {
          const aborted = () => reject(signal.reason);
          signal.addEventListener("abort", aborted, { once: true });
          transport
            .lookup(hostname)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", aborted));
        });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
      throw new Error("日历订阅不能访问本机或保留地址");
    const response = await transport.request(url, addresses[0] as Address, signal);
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || redirects === 3) throw new Error("日历重定向过多");
        url = new URL(response.location, url);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error("日历拉取失败");
      const source = Readable.from(
        (async function* () {
          let rawBytes = 0;
          for await (const chunk of response.body) {
            rawBytes += chunk.byteLength;
            if (rawBytes > 10 * 1024 * 1024) throw new Error("日历文件超过 10 MiB");
            yield chunk;
          }
        })(),
      );
      const encoding = response.encoding?.trim().toLowerCase();
      const decoder =
        encoding === "gzip"
          ? createGunzip()
          : encoding === "deflate"
            ? createInflate()
            : encoding === "br"
              ? createBrotliDecompress()
              : undefined;
      if (encoding && encoding !== "identity" && !decoder) {
        source.destroy();
        throw new Error("日历压缩格式不支持");
      }
      const stream = decoder ?? source;
      const pumping = decoder
        ? pipeline(source, decoder).catch((error: Error) => {
            decoder.destroy(error);
          })
        : undefined;
      const chunks: Uint8Array[] = [];
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          bytes += chunk.byteLength;
          if (bytes > 10 * 1024 * 1024) throw new Error("日历解压内容超过 10 MiB");
          chunks.push(chunk);
        }
        await pumping;
      } finally {
        stream.destroy();
        source.destroy();
      }
      return Buffer.concat(chunks);
    } finally {
      response.close();
    }
  }
  throw new Error("日历重定向过多");
}
