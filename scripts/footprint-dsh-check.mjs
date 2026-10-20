// Actual DSH host, actual bundled plugin and its 5s subscribe interval, isolated profile only.
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.env.FOOTPRINT_DSH_TEST_URL;
if (!url?.startsWith("http://127.0.0.1:8877/")) throw new Error("Dedicated DSH URL required");
const list = await fetch("http://127.0.0.1:9338/json/list").then((r) => r.json());
let target = list.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8877/"));
if (!target) {
  await fetch(`http://127.0.0.1:9338/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  target = (await fetch("http://127.0.0.1:9338/json/list").then((r) => r.json())).find(
    (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8877/"),
  );
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const remoteCalls = [];
const errors = [];
const traffic = [];
socket.addEventListener("message", (e) => {
  const v = JSON.parse(e.data);
  if (v.id) {
    const p = pending.get(v.id);
    pending.delete(v.id);
    v.error ? p.reject(v.error) : p.resolve(v.result);
  }
  if (v.method === "Network.requestWillBeSent" && v.params.request.url.startsWith("http://127.0.0.1:8877/")) {
    const r = v.params.request;
    traffic.push({
      kind: "http",
      path: new URL(r.url).pathname,
      method: r.method,
      time: v.params.timestamp,
      mapCall: /lifeMap/.test(r.url + (r.postData ?? "")),
    });
  }
  if (v.method === "Network.webSocketFrameSent") {
    traffic.push({ kind: "ws", bytes: v.params.response.payloadData.length, time: v.params.timestamp });
    const f = v.params.response;
    const text = f.opcode === 2 ? Buffer.from(f.payloadData, "base64").toString() : f.payloadData;
    if (text.includes("lifeMap")) remoteCalls.push({ time: v.params.timestamp, method: "lifeMap" });
  }
  if (v.method === "Runtime.exceptionThrown") errors.push(v.params.exceptionDetails);
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await command("Runtime.enable");
await command("Page.enable");
await command("Network.enable");
await command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await command("Page.navigate", { url });
await pause(6000);
const click = async (label, scope = "") => {
  const p = await evaluate(
    `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(scope ? scope : "button")})];const b=nodes.find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
};
await command("Page.bringToFront");
if (await evaluate("document.body.innerText.includes('预览版说明')")) {
  await click("继续");
  await pause(300);
}
await click("开图");
await pause(1800);
await click("开图", 'nav[aria-label="主要导航"] button:not([aria-label])');
await pause(400);
await click("足迹");
for (let i = 0; i < 80; i++) {
  if (await evaluate("!!document.querySelector('.maplibregl-marker')")) break;
  await pause(100);
}
await pause(1800);
const bounds = await evaluate(
  "(()=>{const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()",
);
const marker = () =>
  evaluate(
    "(()=>{const r=document.querySelector('.maplibregl-marker').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
const before = await marker();
const start = { x: bounds.x + bounds.width * 0.45, y: Math.min(800, bounds.y + bounds.height * 0.45) };
await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
await command("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", clickCount: 1 });
for (let i = 1; i <= 8; i++) {
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x + i * 20,
    y: start.y + i * 5,
    button: "left",
    buttons: 1,
  });
  await pause(20);
}
await command("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: start.x + 160,
  y: start.y + 40,
  button: "left",
  clickCount: 1,
});
await pause(500);
const panned = await marker();
const trafficBefore = traffic.length;
const samples = [];
for (let i = 0; i < 3; i++) {
  await pause(5200);
  samples.push({ ...(await marker()), trafficCount: traffic.length });
}
const result = {
  host: "isolated DSH 0.2.1-rc.2",
  visibility: await evaluate("document.visibilityState"),
  before,
  panned,
  samples,
  trafficBefore,
  traffic,
  remoteCalls,
  errors,
};
if (Math.abs(panned.x - before.x) < 80) throw Error("Map did not pan");
if (samples.some((p) => Math.abs(p.x - panned.x) > 2 || Math.abs(p.y - panned.y) > 2))
  throw Error("Subscription reset the camera");
console.log(JSON.stringify(result));
mkdirSync("docs/acceptance/footprint-step1-2026-10-20/product", { recursive: true });
writeFileSync(
  "docs/acceptance/footprint-step1-2026-10-20/product/dsh-subscription.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
writeFileSync(
  "docs/acceptance/footprint-step1-2026-10-20/product/dsh-panned-after-polls.png",
  Buffer.from(screenshot.data, "base64"),
);
socket.close();
