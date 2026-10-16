import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 每个测试进程一开始就把 HOME 指到临时目录：测试超时或恢复环境变量时，也碰不到真实的 iCloud、Drive 和本机状态目录。
const home = mkdtempSync(join(tmpdir(), "kaitu-test-home-"));
process.env.HOME = home;
process.env.XDG_STATE_HOME = join(home, ".local/state");
process.env.LOCALAPPDATA = join(home, "AppData/Local");
for (const key of ["KAITU_DIR", "KAITU_APP_HOME", "KAITU_LOCAL_STATE_DIR"]) delete process.env[key];
