// Operates the unmodified normal product UI and real HTTP/SSE endpoints.
// Only the dedicated integration profile on port 9338 and synthetic server are allowed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const server = process.argv[2] ?? "http://127.0.0.1:8874/";
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
const tag = process.argv[3] ?? "sample";
const prefix = tag === "sample" ? "" : `${tag}-`;
const folder = "docs/acceptance/footprint-step1-2026-10-20/product";
mkdirSync(folder, { recursive: true });
const shot = async (name) => {
  const r = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${folder}/${name}.png`, Buffer.from(r.data, "base64"));
};
await command("Page.bringToFront");
await command("Runtime.enable");
await command("Page.enable");
await command("Network.enable");
await command("Log.enable");
await command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
const started = performance.now();
await command("Page.navigate", { url: server });
await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开图')");
await until("!document.body.innerText.includes('正在读取开图')");
const appReadyUpperMs = performance.now() - started;
console.log(JSON.stringify({ appReadyUpperMs, body: await evaluate("document.body.innerText") }));
await click("开图");
await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='足迹')");
const beforeFootprints = performance.now();
await click("足迹");
await until("!!document.querySelector('.maplibregl-canvas')");
let palette = 0;
for (let i = 0; i < 40; i++) {
  const clip = await evaluate(
    "(()=>{const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return {x:r.x+r.width*.25,y:r.y+r.height*.4,width:120,height:120,scale:1}})()",
  );
  const r = await command("Page.captureScreenshot", { format: "png", clip });
  palette = await evaluate(
    `new Promise(resolve=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=120;c.height=120;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,120,120).data;const colors=new Set();for(let i=0;i<data.length;i+=16)colors.add(data[i]+','+data[i+1]+','+data[i+2]);resolve(colors.size);};image.src='data:image/png;base64,${r.data}';})`,
  );
  if (palette > 40) break;
  await pause(50);
}
const firstMapObservedUpperMs = performance.now() - beforeFootprints;
await pause(3000);
const api = await evaluate(
  "fetch('/api/product/lifeMap',{method:'POST',headers:{'Content-Type':'application/json','X-Kaitu':'1'},body:'[]'}).then(r=>r.json())",
);
const result = {
  server,
  appReadyUpperMs,
  firstMapObservedUpperMs,
  palette,
  api: {
    records: api.experiences.length,
    cities: new Set(api.experiences.map((e) => e.place.geonameid)).size,
    current: api.currentPlace,
    source: api.experiences[0]?.source,
  },
  resourceTimings: await evaluate(
    "performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/product/lifeMap')).map(e=>({duration:e.duration,transferSize:e.transferSize,decodedBodySize:e.decodedBodySize}))",
  ),
};
if (tag === "sample") {
  if (api.experiences.length !== 31) throw Error("Sample data mismatch");
  for (const theme of ["light", "dark"]) {
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: theme }],
    });
    await pause(500);
    for (const [state, label] of [
      ["now", "此刻"],
      ["history", "来路"],
      ["possible", "可能"],
    ]) {
      await click(label);
      await pause(state === "now" ? 3000 : 1500);
      await shot(`${theme}-${state}`);
    }
  }
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await click("此刻");
  await pause(1500);
  await click("城市与工具");
  result.listOpen = await evaluate(
    "getComputedStyle(document.querySelector('section[aria-label=城市列表]')).display!=='none'",
  );
  const close = await evaluate(
    "(()=>{const b=document.querySelector('button[aria-label=关闭城市列表]');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...close,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...close,
    button: "left",
    clickCount: 1,
  });
  await pause(200);
  result.listClosed = await evaluate(
    "getComputedStyle(document.querySelector('section[aria-label=城市列表]')).display==='none'",
  );
  if (!result.listOpen || !result.listClosed) throw Error("List mouse close failed");
  await shot("list-closed");
  const marker = () =>
    evaluate(
      "(()=>{const r=document.querySelector('.maplibregl-marker').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
    );
  const before = await marker();
  const mapRect = await evaluate(
    "(()=>{const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()",
  );
  const start = { x: mapRect.x + mapRect.width * 0.45, y: mapRect.y + mapRect.height * 0.45 };
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...start,
    button: "left",
    clickCount: 1,
  });
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
  await pause(400);
  const panned = await marker();
  const path = "/tmp/kaitu-footprint-integration-20261020/sample/me/profile.md";
  const original = readFileSync(path, "utf8");
  const readsBefore = events.responses.filter((e) => e.url.endsWith("/api/product/lifeMap")).length;
  writeFileSync(path, original);
  await pause(2500);
  const after = await marker();
  const readsAfter = events.responses.filter((e) => e.url.endsWith("/api/product/lifeMap")).length;
  result.sse = { before, panned, after, readsBefore, readsAfter };
  if (Math.abs(panned.x - before.x) < 80 || Math.abs(after.x - panned.x) > 2 || readsAfter <= readsBefore)
    throw Error("Real SSE refresh moved the camera or did not refresh");
  // Remove only the synthetic explicit current city, so residence fallback is exercised.
  writeFileSync(path, original.replace(/^现居城市：.*\n?/m, ""));
  await until("document.body.innerText.includes('最近的居住记录')");
  const openSummary = async (text) => {
    const p = await evaluate(
      `(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  await openSummary("地图工具 · 图层与时间");
  await click("2010");
  await pause(500);
  result.year2010 = await evaluate("document.body.innerText.includes('上海 · 最近的居住记录')");
  await click("重置筛选");
  await click("走过的地方");
  await click("现在的生活");
  await click("可能");
  await pause(1500);
  result.plannedAnchorVisible = await evaluate("!!document.querySelector('.maplibregl-marker')");
  await shot("planned-only-with-anchor");
  await click("此刻");
  await pause(1500);
  result.plannedOnlyNow = await evaluate("document.body.innerText.includes('上海 · 最近的居住记录')");
  if (!result.year2010 || !result.plannedAnchorVisible || !result.plannedOnlyNow)
    throw Error("Filter changed the current anchor");
  writeFileSync(path, original);
  await pause(1000);
  await click("重置筛选");
}
if (tag === "large") {
  result.switches = [];
  for (const label of ["来路", "可能", "此刻"]) {
    const began = performance.now();
    await click(label);
    await until(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='${label}'&&b.getAttribute('aria-pressed')==='true')`,
    );
    result.switches.push({ label, feedbackObservedUpperMs: performance.now() - began });
    await pause(1500);
    await shot(`large-${label === "来路" ? "history" : label === "可能" ? "possible" : "now"}`);
  }
}
if (tag === "empty") {
  if (api.experiences.length !== 0) throw Error("Empty fixture mismatch");
  result.emptyActions = {};
  await click("来路");
  await pause(1400);
  await shot("empty-history");
  await click("从照片或记忆里找");
  await pause(600);
  await until("[...document.querySelectorAll('textarea')].some(e=>e.value.includes('build-life-map'))");
  result.emptyActions.historyPrompt = true;
  if (await evaluate("!!document.querySelector('dialog:modal')")) await click("以后再说");
  await shot("empty-history-action");
  await click("开图");
  await click("足迹");
  await until("!!document.querySelector('.maplibregl-canvas')");
  await click("可能");
  await pause(1400);
  await click("加一个");
  await until("!!document.querySelector('form[aria-label=设置现居城市]')");
  result.emptyActions.possibleRequiresOrigin = true;
  await click("取消");
  await click("此刻");
  await pause(1400);
  await shot("empty-now");
  await click("加一个");
  await until("!!document.querySelector('form[aria-label=设置现居城市] input')");
  const input = await evaluate(
    "(()=>{const e=document.querySelector('form[aria-label=设置现居城市] input');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...input,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...input,
    button: "left",
    clickCount: 1,
  });
  await command("Input.insertText", { text: "上海" });
  await click("保存现居城市");
  await until("document.body.innerText.includes('上海 · 来自档案现居城市')");
  const saved = await evaluate(
    "fetch('/api/product/lifeMap',{method:'POST',headers:{'Content-Type':'application/json','X-Kaitu':'1'},body:'[]'}).then(r=>r.json())",
  );
  result.emptyActions.savedCurrent = saved.currentPlace;
  result.emptyActions.recordsAfterSave = saved.experiences.length;
  result.emptyActions.hometownAfterSave = saved.hometown;
  if (
    saved.currentPlace?.geonameid !== 1796236 ||
    saved.experiences.length !== 0 ||
    saved.hometown?.status !== "missing"
  )
    throw Error("Current-city save falsified a residence or hometown");
  await shot("empty-saved-current");
}
await shot(`${prefix}final`);
result.body = await evaluate("document.body.innerText");
Object.assign(result, events);
writeFileSync(`${folder}/${tag}-startup.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    tag,
    appReadyUpperMs,
    firstMapObservedUpperMs,
    palette,
    api: result.api,
    listOpen: result.listOpen,
    listClosed: result.listClosed,
    sse: result.sse,
    year2010: result.year2010,
    plannedOnlyNow: result.plannedOnlyNow,
    violations: events.violations,
    errors: events.errors,
  }),
);
socket.close();
