import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";

export function createDmg({ app, dmg, temporary, identity, notarize }) {
  if (existsSync(dmg)) throw new Error(`输出已存在，请另选目录：${dmg}`);
  const staging = join(temporary, "dmg");
  mkdirSync(staging);
  const stagedApp = join(staging, "Kaitu.app");
  execFileSync("/usr/bin/ditto", [app, stagedApp]);
  symlinkSync("/Applications", join(staging, "Applications"));
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedApp], {
    stdio: "inherit",
  });
  const image = join(temporary, "Kaitu.dmg");
  // makehybrid adds Finder metadata to Mach-O files, invalidating their strict signatures.
  execFileSync(
    "/usr/bin/hdiutil",
    ["create", "-srcfolder", staging, "-fs", "HFS+", "-volname", "Kaitu", "-format", "UDZO", image],
    { stdio: "inherit" },
  );
  const mount = join(temporary, "verify-mount");
  execFileSync("/usr/bin/hdiutil", ["attach", image, "-readonly", "-nobrowse", "-mountpoint", mount], {
    stdio: "inherit",
  });
  try {
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", join(mount, "Kaitu.app")], {
      stdio: "inherit",
    });
  } finally {
    execFileSync("/usr/bin/hdiutil", ["detach", mount], { stdio: "inherit" });
  }
  if (identity) {
    execFileSync("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp", image], {
      stdio: "inherit",
    });
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", image], { stdio: "inherit" });
  }
  if (notarize) notarize(image, image);
  renameSync(image, dmg);
  console.log(`完成：${dmg}`);
}
