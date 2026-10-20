// Keep localhost alive while blocking external HTTPS: the same boundary as an offline local app.
import { mkdirSync, writeFileSync } from "node:fs";
const target = (await fetch("http://127.0.0.1:9338/json/list").then((r) => r.json())).find(
  (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8874/"),
);
if (!target) throw Error("Dedicated synthetic sample tab required");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener("message", (e) => {
  const v = JSON.parse(e.data);
  if (v.id) {
    const p = pending.get(v.id);
    pending.delete(v.id);
    v.error ? p.reject(v.error) : p.resolve(v.result);
  }
});
const command = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expression) => {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error(`Timeout ${expression}`);
};
const click = async (label) => {
  const p = await evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
};
const folder = "docs/acceptance/footprint-step1-2026-10-20/product";
mkdirSync(folder, { recursive: true });
const shot = async (name) => {
  const r = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${folder}/${name}.png`, Buffer.from(r.data, "base64"));
};
await command("Page.bringToFront");
await command("Network.enable");
await command("Network.setBlockedURLs", { urls: ["https://*"] });
const network = (offline) =>
  command("Network.overrideNetworkState", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
try {
  await network(true);
  await command("Page.navigate", { url: "http://127.0.0.1:8874/" });
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开图')");
  await click("开图");
  await click("足迹");
  await until("document.body.innerText.includes('需要联网才能看城市细节')");
  await shot("offline-city");
  const result = { offlineCity: { onLine: await evaluate("navigator.onLine"), notice: true } };
  await click("可能");
  await pause(1500);
  await shot("offline-global");
  result.global = {
    onLine: await evaluate("navigator.onLine"),
    canvas: await evaluate("!!document.querySelector('.maplibregl-canvas')"),
    body: await evaluate("document.body.innerText"),
  };
  await network(false);
  await click("此刻");
  await until("document.body.innerText.includes('城市细节暂不可用')");
  await shot("city-service-unavailable");
  result.providerFailure = {
    onLine: await evaluate("navigator.onLine"),
    unavailable: true,
    incorrectOfflineMessage: await evaluate("document.body.innerText.includes('需要联网才能看城市细节')"),
  };
  if (
    result.offlineCity.onLine ||
    result.global.onLine ||
    !result.providerFailure.onLine ||
    result.providerFailure.incorrectOfflineMessage
  )
    throw Error("Network status was misrepresented");
  writeFileSync(`${folder}/offline-product.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await network(false);
  await command("Network.setBlockedURLs", { urls: [] });
  socket.close();
}
