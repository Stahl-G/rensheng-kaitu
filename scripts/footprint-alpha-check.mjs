// Operates the unmodified normal product UI and real HTTP/SSE endpoints.
// Only the dedicated integration profile on port 9338 and synthetic server are allowed.
import { mkdirSync, writeFileSync } from "node:fs";
const server = "http://127.0.0.1:8874/";
if (!/^http:\/\/127\.0\.0\.1:887[4-6]\/$/.test(server)) throw new Error("Synthetic server required");
const targets = await fetch("http://127.0.0.1:9338/json/list").then((r) => r.json());
const target = targets.find(
  (t) => t.type === "page" && (t.url === "about:blank" || /^http:\/\/127\.0\.0\.1:887[4-6]\//.test(t.url)),
);
if (!target) throw new Error("Dedicated integration tab missing");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
const events = { errors: [], violations: [], responses: [], failures: [] };
socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  if (value.id) {
    const p = pending.get(value.id);
    pending.delete(value.id);
    value.error ? p.reject(value.error) : p.resolve(value.result);
  }
  if (value.method === "Runtime.exceptionThrown") events.errors.push(value.params.exceptionDetails);
  if (
    value.method === "Log.entryAdded" &&
    /Content Security|Refused to connect/.test(value.params.entry.text)
  )
    events.violations.push(value.params.entry);
  if (value.method === "Network.responseReceived")
    events.responses.push({
      id: value.params.requestId,
      url: value.params.response.url,
      status: value.params.response.status,
      time: value.params.timestamp,
      headers: value.params.response.headers,
    });
  if (value.method === "Network.loadingFailed") events.failures.push(value.params);
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
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`Timeout ${expression}`);
};
const rect = (label) =>
  evaluate(
    `(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('Missing button '+${JSON.stringify(label)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
const click = async (label) => {
  const p = await rect(label);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
};
const folder = "docs/acceptance/footprint-step1-2026-10-20/design-review";
await command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await command("Runtime.enable");
await command("Page.enable");
await command("Network.enable");
await command("Network.overrideNetworkState", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await command("Network.setBlockedURLs", { urls: [] });
await command("Emulation.setEmulatedMedia", {
  features: [
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ],
});
await command("Page.navigate", { url: server });
await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开图')");
await click("开图");
await click("足迹");
await until("!!document.querySelector('.maplibregl-marker')");
await click("来路");
await pause(2000);
const shot = async (name) => {
  const r = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${folder}/${name}.png`, Buffer.from(r.data, "base64"));
};
const geometry = await evaluate(
  "[...document.querySelectorAll('.maplibregl-marker')].map(e=>({text:e.textContent,transform:e.style.transform,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}))",
);
await shot("alpha-routes");
const mouse = async (p) => {
  for (const type of ["mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
};
await mouse(
  await evaluate(
    "(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('地图工具'));e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+30,y:r.y+10}})()",
  ),
);
await mouse(
  await evaluate(
    "(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='经历连线').querySelector('input');e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
  ),
);
await mouse(
  await evaluate(
    "(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('地图工具'));e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+30,y:r.y+10}})()",
  ),
);
await evaluate("document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0})");
await pause(500);
await shot("alpha-basemap");
writeFileSync(`${folder}/alpha-geometry.json`, `${JSON.stringify(geometry, null, 2)}\n`);
console.log(geometry);
socket.close();
