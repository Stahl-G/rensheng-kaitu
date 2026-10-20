import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import semver from "semver";

export const RELEASE_FEED = "https://github.com/Stahl-G/rensheng-kaitu/releases/latest/download/latest.json";

// Only public verification material is embedded in the signed host.
export function readUpdateConfig({ version, configFile, publicKeyFile }) {
  if (configFile && publicKeyFile) throw new Error("更新配置与更新公钥只能指定一个");
  const config = configFile
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : publicKeyFile
      ? { feedUrl: RELEASE_FEED, publicKey: readFileSync(publicKeyFile, "utf8") }
      : null;
  if (!config) {
    if (!semver.prerelease(version))
      throw new Error("正式版宿主必须指定 --update-public-key 或 --update-config");
    return null;
  }
  const url = new URL(config.feedUrl);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
  )
    throw new Error("更新源必须使用 HTTPS");
  if (
    typeof config.publicKey !== "string" ||
    !config.publicKey.trim().startsWith("-----BEGIN PUBLIC KEY-----")
  )
    throw new Error("只能打包公开验签公钥");
  const key = createPublicKey(config.publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("更新公钥必须为 Ed25519");
  return { feedUrl: url.href, publicKey: key.export({ type: "spki", format: "pem" }) };
}
