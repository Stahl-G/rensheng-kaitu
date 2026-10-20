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
mkdirSync(folder, { recursive: true });
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
const media = async (theme, motion) =>
  command("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: motion },
    ],
  });
await media("light", "reduce");
await command("Page.navigate", { url: server });
await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开图')");
await click("开图");
await click("足迹");
await until("!!document.querySelector('[data-footprint-me] svg')");
await pause(3500);
const metrics = () =>
  evaluate(
    `(()=>{const root=document.querySelector('[data-footprint-me]'),head=root.querySelector('[data-me-head]'),ring=root.querySelector('[data-me-ring]'),tail=root.querySelector('path'),glow=root.firstElementChild.firstElementChild,label=root.querySelector('span');const m=tail.getScreenCTM(),scale=Math.hypot(m.a,m.b);const point=(x,y)=>new DOMPoint(x,y).matrixTransform(m);const a=point(30.67,29.5),b=point(39.5,16);const r=ring.getBoundingClientRect();return{count:document.querySelectorAll('[data-footprint-me]').length,svgs:root.querySelectorAll('svg').length,gradient:root.querySelector('linearGradient').id,head:head.getBoundingClientRect().width,ringOuter:r.width+Number.parseFloat(getComputedStyle(ring).strokeWidth)*(head.getBoundingClientRect().width/8),tailLength:tail.getTotalLength()*scale,tailStroke:Number.parseFloat(getComputedStyle(tail).strokeWidth)*scale,tailVector:{x:a.x-b.x,y:a.y-b.y},rotation:root.querySelector('[data-me-direction]').getAttribute('transform'),mapBearing:Number(root.dataset.mapBearing),label:label.textContent,labelTransform:getComputedStyle(label).transform,headFill:getComputedStyle(head).fill,glowWidth:glow.getBoundingClientRect().width,glowAnimation:getComputedStyle(glow).animationName,glowDuration:getComputedStyle(glow).animationDuration,mode:root.dataset.mode,rootTransform:root.style.transform};})()`,
  );
const result = { now: await metrics() };
const attr = () =>
  evaluate(
    "(()=>{const e=document.querySelector('.maplibregl-ctrl-attrib');return{expanded:e.classList.contains('maplibregl-compact-show'),text:e.querySelector('.maplibregl-ctrl-attrib-inner').textContent}})()",
  );
result.attributionDefault = await attr();
const at = await evaluate(
  "(()=>{const r=document.querySelector('.maplibregl-ctrl-attrib-button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
);
for (const type of ["mousePressed", "mouseReleased"])
  await command("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
await pause(100);
result.attributionExpanded = await attr();
for (const type of ["mousePressed", "mouseReleased"])
  await command("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
await click("+");
await click("+");
await pause(500);
result.zoomed = await metrics();
await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 550 });
await command("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: 400,
  y: 550,
  button: "right",
  clickCount: 1,
});
for (let i = 1; i <= 12; i++) {
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 400 + i * 15,
    y: 550,
    button: "right",
    buttons: 2,
  });
  await pause(15);
}
await command("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: 580,
  y: 550,
  button: "right",
  clickCount: 1,
});
await pause(800);
result.rotated = await metrics();
await media("light", "no-preference");
await pause(100);
result.motionEnabled = await metrics();
result.glowExtremes = await evaluate(
  "(()=>{const g=document.querySelector('[data-footprint-me]').firstElementChild.firstElementChild;const a=g.getAnimations()[0];if(!a)return null;a.pause();a.currentTime=0;const start=g.getBoundingClientRect().width;a.currentTime=1200;const end=g.getBoundingClientRect().width;return{start,end};})()",
);
await media("light", "reduce");
await pause(100);
result.reduced = await metrics();
await click("来路");
await pause(800);
result.history = await metrics();
await click("可能");
await pause(300);
result.possible = await metrics();
result.themes = [];
for (const theme of ["dark", "light", "dark", "light"]) {
  await media(theme, "reduce");
  await pause(500);
  result.themes.push(await metrics());
}
await command("Emulation.setDeviceMetricsOverride", {
  width: 780,
  height: 620,
  deviceScaleFactor: 1,
  mobile: false,
});
await click("来路");
await pause(800);
const shot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
writeFileSync(`${folder}/small-history.png`, Buffer.from(shot.data, "base64"));
result.small = await evaluate(
  "[...document.querySelectorAll('.maplibregl-marker')].map(e=>({text:e.textContent,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}))",
);
const near = (a, b) => Math.abs(a - b) < 0.03;
if (
  !near(result.now.head, 8) ||
  !near(result.now.ringOuter, 14) ||
  !near(result.zoomed.head, 8) ||
  !near(result.history.head, 6.8)
)
  throw Error("Pixel size changed");
if (
  Math.abs(result.rotated.mapBearing) < 10 ||
  Math.abs(
    Number(result.rotated.rotation.slice(7, -1)) -
      Number(result.zoomed.rotation.slice(7, -1)) +
      result.rotated.mapBearing -
      result.zoomed.mapBearing,
  ) > 0.1
)
  throw Error("Bearing compensation failed");
if (
  result.reduced.glowAnimation !== "none" ||
  !result.glowExtremes ||
  !near(result.glowExtremes.start, 24) ||
  !near(result.glowExtremes.end, 27.6)
)
  throw Error("Reduced motion/glow failed");
if (result.themes.some((m) => m.count !== 1 || m.svgs !== 1 || m.gradient !== result.now.gradient))
  throw Error("Marker duplicated");
if (
  result.attributionDefault.expanded ||
  !result.attributionExpanded.expanded ||
  !result.attributionExpanded.text.includes("Terrain")
)
  throw Error("Attribution behavior failed");
writeFileSync(`${folder}/marker-browser.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
socket.close();
