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
const folder = "docs/acceptance/footprint-step1-2026-10-20/region-marker-A";
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
await command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await command("Emulation.setEmulatedMedia", {
  features: [
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ],
});
const result = [];
for (const [name, port] of [
  ["north", 8875],
  ["south", 8876],
]) {
  await command("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开图')");
  await click("开图");
  await click("足迹");
  await until("!!document.querySelector('[data-footprint-me] svg')");
  await pause(1000);
  const metrics = await evaluate(
    "(()=>{const root=document.querySelector('[data-footprint-me]'),p=root.querySelector('path'),m=p.getScreenCTM(),a=new DOMPoint(30.67,29.5).matrixTransform(m),b=new DOMPoint(39.5,16).matrixTransform(m);return{label:root.textContent,vector:{x:a.x-b.x,y:a.y-b.y},rotation:root.querySelector('[data-me-direction]').getAttribute('transform'),head:root.querySelector('[data-me-head]').getBoundingClientRect().width}})()",
  );
  const api = await evaluate(
    "fetch('/api/product/lifeMap',{method:'POST',headers:{'Content-Type':'application/json','X-Kaitu':'1'},body:'[]'}).then(r=>r.json())",
  );
  result.push({
    name,
    ...metrics,
    records: api.experiences.map((e) => ({ place: e.place, start: e.start, end: e.end })),
  });
  const shot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${folder}/direction-${name}.png`, Buffer.from(shot.data, "base64"));
}
if (!(result[0].vector.y < 0 && result[1].vector.y > 0)) throw Error("Opposite direction not rendered");
writeFileSync(`${folder}/direction-browser.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
socket.close();
