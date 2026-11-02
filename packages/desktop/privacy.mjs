import { createHash } from "node:crypto";
import { readPreferences, savePreferences } from "../core/dist/index.js";

// Bump when the notice or outgoing-data scope changes, including for existing installations.
export const PRIVACY_NOTICE_VERSION = "2026-11-02.1";
const ACTION = "https://kaitu.invalid/privacy";
const items = [
  [
    "storage",
    ["资料与本机状态", "Storage and app state"],
    [
      "个人资料保存在你选的资料文件夹，版本历史、凭据和界面设置保存在本机。本版不将个人档案发送到开图自营服务，独立桌面版关闭内置遥测和会话日志上报。",
      "Personal data stays in your chosen folder; history, credentials and settings stay on this computer. This version does not send personal profiles to a Kaitu-operated service. Built-in telemetry and session-log reporting are disabled in the standalone desktop app.",
    ],
  ],
  [
    "ai",
    ["模型与 Agent", "Models and agents"],
    [
      "问问的消息及为回答读取的资料，会交给你配置的模型或 Agent 及其服务商。已开启的自动任务会在确认后恢复，按原设置读取和发送资料；完整 Agent 可读取工作区之外的文件。第三方如何留存和使用资料，依其政策。不开启 AI 也能使用开图。",
      "Ask messages and data read to answer them go to your configured model or agent and its provider. Previously enabled automatic tasks resume after acknowledgment and read and send data under their existing settings. Full agents can read files outside the workspace. Third-party retention and use follow their policies. You can use Kaitu without AI.",
    ],
  ],
  [
    "sync",
    ["你选择的同步服务", "Your chosen sync services"],
    [
      "选择 iCloud、Google Drive、坚果云等同步文件夹后，其中的资料由该服务同步；开启 GitHub 同步后，所选范围会发送到绑定仓库。能访问云盘或仓库的人员和云端 Agent 也可能读到这些资料。",
      "Files in an iCloud, Google Drive, Nutstore or other synced folder are synced by that service. GitHub sync sends the selected data to your connected repository. People and cloud agents with access to that folder or repository may also read it.",
    ],
  ],
  [
    "location",
    ["天气与地图", "Weather and maps"],
    [
      "天气把所选城市（也可能来自足迹现居城市）的坐标发给 Open-Meteo；地图放大后向 OpenFreeMap 和 AWS Terrain Tiles 请求当前区域的瓦片。服务会收到请求区域、IP 地址等常规网络信息。",
      "Weather sends the selected city's coordinates, which may come from your current city in Footprints, to Open-Meteo. Zooming in requests map tiles for the visible area from OpenFreeMap and AWS Terrain Tiles. These services receive the requested area, IP address and standard network metadata.",
    ],
  ],
  [
    "connections",
    ["更新与其他连接", "Updates and other connections"],
    [
      "更新检查访问 GitHub，浏览插件目录访问开图站点；网络搜索、网页、Yahoo 行情、日历、邮件和聊天按所用功能访问对应服务，传输查询、代码、账号授权或消息等必要内容。第三方插件还可能连接自己的服务。",
      "Update checks contact GitHub; browsing the plugin catalog contacts the Kaitu site. Search, web pages, Yahoo quotes, calendars, email and chat contact their respective services with the queries, symbols, account authorization or messages needed for that feature. Third-party plugins may connect to their own services.",
    ],
  ],
  [
    "permissions",
    ["知悉与授权", "Acknowledgment and permissions"],
    [
      "逐项勾选表示已了解资料去向，不授予健康、照片、位置、共享或额外外发权限；具体功能仍按原有权限和确认流程操作。你可以退出，并随时在设置中重新查看这份说明。",
      "Checking each item acknowledges where data goes. It does not grant health, photo, location, sharing or additional data-transfer permissions; feature-specific permissions and confirmations still apply. You can exit and review this notice in Settings at any time.",
    ],
  ],
];

export function privacyNoticeHtml({ locale = "zh-CN", review = false } = {}) {
  const pair = ([zh, en]) => `<span lang="zh-CN">${zh}</span><span lang="en">${en}</span>`;
  const script = `const form = document.querySelector('form');
const checks = [...document.querySelectorAll('input[type=checkbox]')];
const submit = document.querySelector('#continue');
form.addEventListener('change', () => { if (submit) submit.disabled = !checks.every(c => c.checked); });
document.querySelector('select').addEventListener('change', event => {
  document.documentElement.lang = event.target.value;
  document.title = event.target.value === 'en' ? 'Where your data goes' : '资料去向';
});`;
  const hash = createHash("sha256").update(script).digest("base64");
  return `<!doctype html><html lang="${locale === "en" ? "en" : "zh-CN"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; form-action ${ACTION}; base-uri 'none'">
<title>${locale === "en" ? "Where your data goes" : "资料去向"}</title><style>
:root { color-scheme: light dark; font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #262b33; background: #fbfaf8; }
* { box-sizing: border-box; } body { margin: 0; } main { max-width: 820px; height: 100vh; display: flex; flex-direction: column; margin: auto; padding: 28px 24px 0; }
html:lang(en) [lang=zh-CN], html:lang(zh-CN) [lang=en] { display: none; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; } h1 { font-size: 26px; margin: 0; } select, button { font: inherit; }
select { background: transparent; color: inherit; border: 1px solid #858991; border-radius: 7px; padding: 4px; }
.version { color: #626871; margin: 4px 0 20px; font-size: 13px; } form { display: flex; flex-direction: column; min-height: 0; flex: 1; } ul { list-style: none; padding: 0 4px; margin: 0; overflow: auto; flex: 1; }
li { margin: 0 0 12px; border: 1px solid #bfc2c8; border-radius: 12px; } label.item { display: flex; align-items: start; gap: 12px; padding: 16px; cursor: pointer; }
input[type=checkbox] { flex: 0 0 20px; width: 20px; height: 20px; margin: 4px 0 0; accent-color: #344a6c; }
b { display: block; margin-bottom: 4px; } p { margin: 0; } footer { position: sticky; bottom: 0; padding: 16px 0; display: flex; justify-content: flex-end; gap: 12px; background: #fbfaf8; }
button { border: 1px solid #858991; border-radius: 9px; padding: 10px 18px; background: transparent; color: inherit; cursor: pointer; } #continue { color: #fff; background: #29384e; border-color: #29384e; } button:disabled { opacity: .45; cursor: default; }
:focus-visible { outline: 3px solid #688abc; outline-offset: 4px; } #error { color: #b12424; }
@media (prefers-color-scheme: dark) { :root { color: #edece8; background: #202327; } footer { background: #202327; } li { border-color: #555e6b; } .version { color: #b5bac2; } #continue { color: #17202e; background: #c5d5ec; } #error { color: #ffabab; } }
@media (max-width: 480px) { main { padding: 20px 16px 0; } header { flex-wrap: wrap; } label.item { padding: 14px; } }
</style></head><body><main><header><h1>${pair(["资料去向", "Where your data goes"])}</h1>
<label>${pair(["语言", "Language"])} <select aria-label="语言 / Language"><option value="zh-CN" ${locale !== "en" ? "selected" : ""}>中文</option><option value="en" ${locale === "en" ? "selected" : ""}>English</option></select></label></header>
<p class="version">${pair(["说明版本", "Notice version"])} ${PRIVACY_NOTICE_VERSION}</p>
<form action="${ACTION}" method="get"><input type="hidden" name="version" value="${PRIVACY_NOTICE_VERSION}"><ul>
${items.map(([id, title, text]) => `<li><label class="item">${review ? "" : `<input type="checkbox" name="item" value="${id}" required>`}<span><b>${pair(title)}</b>${pair(text)}</span></label></li>`).join("\n")}
</ul><p id="error" role="alert" hidden>${pair(["确认状态未保存，请重试或退出。", "Acknowledgment could not be saved. Retry or exit."])}</p><footer>
<button name="action" value="exit" type="submit" formnovalidate>${pair(review ? ["关闭", "Close"] : ["退出开图", "Exit Kaitu"])}</button>
${review ? "" : `<button id="continue" name="action" value="acknowledge" type="submit" disabled>${pair(["已逐项知悉，继续", "Acknowledge and continue"])}</button>`}
</footer></form></main><script>${script}</script></body></html>`;
}

/** The caller must await this before opening a workspace or starting any services. */
export async function showPrivacyNotice({ window, systemLocale = "zh-CN", review = false }) {
  const preferences = readPreferences();
  if (!review && preferences.privacyNoticeVersion === PRIVACY_NOTICE_VERSION) return true;
  const locale = preferences.locale ?? (/^zh\b/i.test(systemLocale) ? "zh-CN" : "en");
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const cleanup = () => {
    window.webContents.removeListener("will-navigate", navigate);
    window.removeListener("closed", closed);
  };
  const closed = () => {
    cleanup();
    finish(false);
  };
  const navigate = (event, target) => {
    event.preventDefault();
    const url = new URL(target);
    if (`${url.origin}${url.pathname}` !== ACTION) return;
    if (url.searchParams.get("action") === "exit") {
      cleanup();
      finish(false);
      return;
    }
    const checked = url.searchParams.getAll("item");
    if (
      review ||
      url.searchParams.get("action") !== "acknowledge" ||
      url.searchParams.get("version") !== PRIVACY_NOTICE_VERSION ||
      checked.length !== items.length ||
      !items.every(([id]) => checked.includes(id))
    )
      return;
    try {
      savePreferences({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION });
      cleanup();
      finish(true);
    } catch {
      void window.webContents.executeJavaScript("document.querySelector('#error').hidden = false");
    }
  };
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", navigate);
  window.once("closed", closed);
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(privacyNoticeHtml({ locale, review }))}`,
    );
    if (!window.isDestroyed()) window.show();
    return await result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
