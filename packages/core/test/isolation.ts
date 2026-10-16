import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "kaitu-test-home-"));
process.env.HOME = home;
process.env.XDG_STATE_HOME = join(home, "state");
process.env.LOCALAPPDATA = join(home, "local");
process.env.KAITU_LOCAL_STATE_DIR = join(home, "kaitu-state");
afterAll(() => rmSync(home, { recursive: true, force: true }));
