#!/usr/bin/env node
// 手机整理只加载所需的数据处理代码；其余命令保留原有入口。
if (process.argv[2] === "phone") await import("./phone-command.js");
else await import("./commands.js");
