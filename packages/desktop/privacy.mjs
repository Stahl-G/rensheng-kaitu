import { createHash } from "node:crypto";
import { readPreferences, savePreferences } from "../core/dist/index.js";

// Bump when the notice or outgoing-data scope changes, including for existing installations.
export const PRIVACY_NOTICE_VERSION = "2026-11-02.3";
const ACTION = "https://kaitu.invalid/privacy";
const summary = [
  [
    ["资料在你自己手里", "Your data stays in your hands"],
    [
      "资料存在本机或你选择的存储中，开图不把个人档案上传到自营服务器。",
      "Your data is stored on this computer or in storage you choose. Kaitu does not upload personal profiles to its own servers.",
    ],
  ],
  [
    ["AI 用到哪些资料", "What AI receives"],
    [
      "对话内容和为任务读取的相关资料，会发送给你选择的 AI 服务或 Agent。",
      "Conversation content and relevant data read for a task go to the AI service or agent you choose.",
    ],
  ],
  [
    ["敏感资料由你决定", "You decide about sensitive data"],
    [
      "财务资料的工具访问、云同步和完整 Agent 是否启用，由你选择。",
      "You choose financial-data tool access, cloud sync and whether to use a full agent.",
    ],
  ],
];
const items = [
  [
    ["资料与本机状态", "Storage and app state"],
    [
      "个人资料保存在你选的资料文件夹，版本历史、凭据和界面设置保存在本机。本版不将个人档案发送到开图自营服务，独立桌面版关闭内置遥测和会话日志上报。",
      "Personal data stays in your chosen folder; history, credentials and settings stay on this computer. This version does not send personal profiles to a Kaitu-operated service. Built-in telemetry and session-log reporting are disabled in the standalone desktop app.",
    ],
  ],
  [
    ["模型与 Agent", "Models and agents"],
    [
      "问问的消息及为回答读取的资料，会交给你配置的模型或 Agent 及其服务商。已开启的自动任务会在开始使用后恢复，按原设置读取和发送资料；完整 Agent 可读取工作区之外的文件。第三方如何留存和使用资料，依其政策。不开启 AI 也能使用开图。",
      "Ask messages and data read to answer them go to your configured model or agent and its provider. Previously enabled automatic tasks resume after you get started and read and send data under their existing settings. Full agents can read files outside the workspace. Third-party retention and use follow their policies. You can use Kaitu without AI.",
    ],
  ],
  [
    ["你选择的同步服务", "Your chosen sync services"],
    [
      "选择 iCloud、Google Drive、坚果云等同步文件夹后，其中的资料由该服务同步；开启 GitHub 同步后，所选范围会发送到绑定仓库。能访问云盘或仓库的人员和云端 Agent 也可能读到这些资料。",
      "Files in an iCloud, Google Drive, Nutstore or other synced folder are synced by that service. GitHub sync sends the selected data to your connected repository. People and cloud agents with access to that folder or repository may also read it.",
    ],
  ],
  [
    ["天气与地图", "Weather and maps"],
    [
      "天气把所选城市（也可能来自足迹现居城市）的坐标发给 Open-Meteo；显示地图细节时（包括自动移至现居城市），会向 OpenFreeMap 和 AWS Terrain Tiles 请求当前区域的瓦片。服务会收到请求区域、IP 地址等常规网络信息。",
      "Weather sends the selected city's coordinates, which may come from your current city in Footprints, to Open-Meteo. Displaying map details, including when the map automatically moves to your current city, requests tiles for the visible area from OpenFreeMap and AWS Terrain Tiles. These services receive the requested area, IP address and standard network metadata.",
    ],
  ],
  [
    ["更新与其他连接", "Updates and other connections"],
    [
      "更新检查访问 GitHub，浏览插件目录访问开图站点；网络搜索、网页、Yahoo 行情、日历、邮件和聊天按所用功能访问对应服务，传输查询、代码、账号授权或消息等必要内容。第三方插件还可能连接自己的服务。",
      "Update checks contact GitHub; browsing the plugin catalog contacts the Kaitu site. Search, web pages, Yahoo quotes, calendars, email and chat contact their respective services with the queries, symbols, account authorization or messages needed for that feature. Third-party plugins may connect to their own services.",
    ],
  ],
  [
    ["权限与访问范围", "Permissions and access"],
    [
      "点击「开始使用」只记录你已读过本版说明，不授予健康、照片、位置、共享或额外外发权限；具体功能仍按原有权限和确认流程操作。财务资料的工具访问可按连接设置；完整 Agent 直接读取文件时不受这些工具开关限制。设置中可随时查看完整政策。",
      "Get started only records that you have read this notice version. It does not grant health, photo, location, sharing or additional data-transfer permissions; feature-specific permissions and confirmations still apply. Financial-data tool access can be set per connection; these tool switches do not restrict a full agent's direct file access. You can review the full policy in Settings at any time.",
    ],
  ],
];

export function privacyNoticeHtml({ locale = "zh-CN", review = false } = {}) {
  const pair = ([zh, en]) => `<span lang="zh-CN">${zh}</span><span lang="en">${en}</span>`;
  const script = `let full = ${review};
const display = (focus = false) => {
  document.querySelector('#summary').hidden = full;
  document.querySelector('#policy').hidden = !full;
  document.querySelector('#summary-title').hidden = full;
  document.querySelector('#policy-title').hidden = !full;
  for (const id of ['policy-link', 'continue']) { const element = document.getElementById(id); if (element) element.hidden = full; }
  const back = document.querySelector('#back'); if (back) back.hidden = !full;
  const en = document.documentElement.lang === 'en';
  document.title = full ? (en ? 'Privacy policy' : '完整隐私政策') : (en ? 'Privacy' : '隐私');
  document.querySelector('.content').scrollTop = 0;
  if (focus) document.querySelector('h1').focus();
};
for (const [id, policy] of [['policy-link', true], ['back', false]]) {
  document.getElementById(id)?.addEventListener('click', event => { event.preventDefault(); full = policy; display(true); });
}
document.querySelector('select').addEventListener('change', event => { document.documentElement.lang = event.target.value; display(); });
display();`;
  const hash = createHash("sha256").update(script).digest("base64");
  return `<!doctype html><html lang="${locale === "en" ? "en" : "zh-CN"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; form-action ${ACTION}; base-uri 'none'">
<title>${locale === "en" ? "Privacy" : "隐私"}</title><style>
:root { color-scheme: light dark; font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #262b33; background: #fbfaf8; }
* { box-sizing: border-box; } body { margin: 0; } main { max-width: 820px; height: 100vh; display: flex; flex-direction: column; margin: auto; padding: 28px 24px 0; }
[hidden], html:lang(en) [lang=zh-CN], html:lang(zh-CN) [lang=en] { display: none !important; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; } h1 { font-size: 26px; margin: 0; } select, button { font: inherit; }
select { background: transparent; color: inherit; border: 1px solid #858991; border-radius: 7px; padding: 4px; }
.version { color: #626871; margin: 16px 0 24px; font-size: 13px; } form { display: flex; flex-direction: column; min-height: 0; flex: 1; } .content { overflow: auto; min-height: 0; flex: 1; padding: 0 4px; }
ul { list-style: none; padding: 24px 0 12px; margin: 0; } li { margin-bottom: 28px; } h2 { display: block; margin: 0 0 6px; font-size: 18px; } #policy section { margin-bottom: 28px; }
p { margin: 0; } footer { padding: 16px 0; display: flex; align-items: center; justify-content: flex-end; gap: 16px; background: #fbfaf8; } a { color: inherit; } #policy-link { margin-right: auto; }
button { border: 1px solid #858991; border-radius: 9px; padding: 10px 18px; background: transparent; color: inherit; cursor: pointer; } #continue { color: #fff; background: #29384e; border-color: #29384e; }
:focus-visible { outline: 3px solid #688abc; outline-offset: 4px; } #error { color: #b12424; }
@media (prefers-color-scheme: dark) { :root { color: #edece8; background: #202327; } footer { background: #202327; } .version { color: #b5bac2; } #continue { color: #17202e; background: #c5d5ec; } #error { color: #ffabab; } }
@media (max-width: 480px) { main { padding: 20px 16px 0; } header { flex-wrap: wrap; } }
</style></head><body><main><header><h1 tabindex="-1"><span id="summary-title">${pair(["隐私", "Privacy"])}</span><span id="policy-title" hidden>${pair(["完整隐私政策", "Privacy policy"])}</span></h1>
<label>${pair(["语言", "Language"])} <select aria-label="语言 / Language"><option value="zh-CN" ${locale !== "en" ? "selected" : ""}>中文</option><option value="en" ${locale === "en" ? "selected" : ""}>English</option></select></label></header>
<form action="${ACTION}" method="get"><input type="hidden" name="version" value="${PRIVACY_NOTICE_VERSION}"><div class="content" tabindex="0">
<section id="summary"><ul>${summary.map(([title, text]) => `<li><h2>${pair(title)}</h2><p>${pair(text)}</p></li>`).join("\n")}</ul></section>
<article id="policy" hidden><p class="version">${pair(["说明版本", "Notice version"])} ${PRIVACY_NOTICE_VERSION}</p>
${items.map(([title, text]) => `<section><h2>${pair(title)}</h2><p>${pair(text)}</p></section>`).join("\n")}</article>
</div><p id="error" role="alert" hidden>${pair(["已读状态未保存，请重试或关闭窗口。", "Reading status could not be saved. Retry or close the window."])}</p><footer>
${review ? `<button name="action" value="close" type="submit">${pair(["关闭", "Close"])}</button>` : `<a id="policy-link" href="#policy">${pair(["完整隐私政策", "Full privacy policy"])}</a><a id="back" href="#privacy" hidden>${pair(["返回", "Back"])}</a><button id="continue" name="action" value="acknowledge" type="submit">${pair(["开始使用", "Get started"])}</button>`}
</footer></form></main><script>${script}</script></body></html>`;
}

/** The caller must await this before opening a workspace or starting any services. */
export async function showPrivacyNotice({ window, systemLocale = "zh-CN", review = false }) {
  const preferences = readPreferences();
  if (!review && preferences.privacyNoticeVersion === PRIVACY_NOTICE_VERSION) return true;
  const locale = preferences.locale ?? (/^zh\b/i.test(systemLocale) ? "zh-CN" : "en");
  const contents = window.webContents;
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const cleanup = () => {
    if (!contents.isDestroyed()) contents.removeListener("will-navigate", navigate);
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
    if (review && url.searchParams.get("action") === "close") {
      cleanup();
      finish(false);
      return;
    }
    if (
      review ||
      url.searchParams.get("action") !== "acknowledge" ||
      url.searchParams.get("version") !== PRIVACY_NOTICE_VERSION
    )
      return;
    try {
      savePreferences({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION });
      cleanup();
      finish(true);
    } catch {
      if (!contents.isDestroyed())
        void contents.executeJavaScript("document.querySelector('#error').hidden = false");
    }
  };
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", navigate);
  window.once("closed", closed);
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(privacyNoticeHtml({ locale, review }))}`,
    );
    if (!window.isDestroyed()) window.show();
    return await result;
  } catch (error) {
    cleanup();
    if (window.isDestroyed()) return false;
    throw error;
  }
}
