// Run only against the explicitly dedicated --headless profile on port 9337.
import { mkdirSync, writeFileSync } from "node:fs";
const targets = await fetch("http://127.0.0.1:9337/json/list").then((r) => r.json());
const target = targets.find(
  (t) => t.type === "page" && (t.url === "about:blank" || t.url.startsWith("http://127.0.0.1:8873/")),
);
if (!target) throw new Error("Dedicated acceptance tab missing");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
const requests = [];
const failures = [];
socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  if (value.id) {
    const p = pending.get(value.id);
    pending.delete(value.id);
    value.error ? p.reject(value.error) : p.resolve(value.result);
  }
  if (value.method === "Network.loadingFailed") failures.push(value.params);
  if (value.method === "Runtime.exceptionThrown") errors.push(value.params.exceptionDetails);
  if (value.method === "Network.requestWillBeSent")
    requests.push({ url: value.params.request.url, time: value.params.timestamp });
});
const command = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (expression) => {
  for (let i = 0; i < 160; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`Timeout: ${expression}`);
};
const folder = "docs/acceptance/footprint-step1-2026-10-20";
mkdirSync(folder, { recursive: true });
const shot = async (name) => {
  const r = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${folder}/${name}.png`, Buffer.from(r.data, "base64"));
};
await command("Runtime.enable");
await command("Page.enable");
await command("Network.enable");
await command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await command("Page.addScriptToEvaluateOnNewDocument", { source: "window.__largeFixture = false;" });
await command("Page.navigate", { url: "http://127.0.0.1:8873/" });
await until("!!window.__firstLocalPaint");
await pause(1600);
const initial = await evaluate(
  "({firstLocalPaint:window.__firstLocalPaint,mapCreated:window.__mapCreatedAt,zoom:window.__acceptanceMap.getZoom(),body:document.body.innerText,webgl:!!window.__acceptanceMap.getCanvas().getContext('webgl2')})",
);
await pause(5000);
await shot("light-now");
const onlineCity = await evaluate(
  "({sources:Object.keys(window.__acceptanceMap.getStyle().sources),notice:document.body.innerText,layers:window.__acceptanceMap.getStyle().layers.map(l=>l.id)})",
);
const select = async (label) =>
  evaluate(
    `new Promise(resolve=>{const m=window.__acceptanceMap; const clicked=performance.now(); let started; m.once('movestart',()=>{started=performance.now()-clicked;}); const samples=[];let last=clicked;function frame(t){samples.push(t-last);last=t;if(t-clicked<1400)requestAnimationFrame(frame);else resolve({startMs:started,frames:samples.length,p95Ms:samples.toSorted((a,b)=>a-b)[Math.floor(samples.length*.95)],maxMs:Math.max(...samples),buttonMs:window.__buttonMs});} requestAnimationFrame(frame); [...document.querySelectorAll('button')].find(b=>b.textContent==='${label}').click(); requestAnimationFrame(()=>{window.__buttonMs=performance.now()-clicked;});})`,
  );
const metrics = { initial, onlineCity, switches: [] };
for (const theme of ["light", "dark"]) {
  if (theme === "dark") {
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='浅 / 深').click()");
    await pause(1500);
  }
  for (const [name, label] of [
    ["now", "此刻"],
    ["history", "来路"],
    ["possible", "可能"],
  ]) {
    metrics.switches.push({ theme, state: name, ...(await select(label)) });
    await shot(`${theme}-${name}`);
  }
}
// Fresh mount with the large fixture selected before React creates the map.
await command("Page.addScriptToEvaluateOnNewDocument", { source: "window.__largeFixture = true;" });
await command("Page.reload", { ignoreCache: true });
await until("!!window.__firstLocalPaint");
await pause(1500);
metrics.large = {
  firstLocalPaint: await evaluate("window.__firstLocalPaint"),
  body: await evaluate("document.body.innerText"),
  switches: [],
};
for (const [name, label] of [
  ["history", "来路"],
  ["possible", "可能"],
  ["now", "此刻"],
])
  metrics.large.switches.push({ state: name, ...(await select(label)) });
await shot("large-now");
await command("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
metrics.reduced = await select("来路");
metrics.reduced.animationActive = await evaluate("window.__acceptanceMap.isMoving()");
await command("Network.setBlockedURLs", { urls: ["https://*"] });
await command("Page.reload", { ignoreCache: true });
await until("!!window.__firstLocalPaint");
await pause(1200);
await shot("offline-city");
metrics.offlineCity = await evaluate("document.body.innerText");
await select("可能");
await shot("offline-global");
metrics.offlineGlobal = await evaluate(
  "({zoom:window.__acceptanceMap.getZoom(),loaded:window.__acceptanceMap.getSource('paper-earth').loaded(),notice:document.body.innerText})",
);
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='切换无数据').click()");
await pause(400);
await shot("empty-possible");
metrics.empty = await evaluate("document.body.innerText");
metrics.errors = errors;
metrics.failures = failures;
metrics.requests = requests.filter((r) => r.url.startsWith("https:"));
console.log(JSON.stringify(metrics));
writeFileSync(`${folder}/browser-results.json`, JSON.stringify(metrics, null, 2));
socket.close();
