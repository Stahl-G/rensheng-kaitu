import { createRequire } from "node:module";

// 独立进程保证官方封包器的输出流全部关闭后，父进程才读取和复制归档。
const [library, source, destination, options] = process.argv.slice(2);
const asar = createRequire(import.meta.url)(library);
await asar.createPackageWithOptions(source, destination, JSON.parse(options));
