// Delay one authentic read-only response to reproduce the hidden-Ask modal race.
// Product source, response body, navigation, and filesystem remain real.
import { writeFileSync } from "node:fs";
const tabs = await fetch("http://127.0.0.1:9338/json/list").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8874/"));
if (!target) throw Error("Dedicated synthetic sample tab required");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
let release;
const held = new Promise((r) => {
  release = r;
});
socket.addEventListener("message", (e) => {
  const v = JSON.parse(e.data);
  if (v.id) {
    const p = pending.get(v.id);
    pending.delete(v.id);
    v.error ? p.reject(v.error) : p.resolve(v.result);
  }
  if (v.method === "Fetch.requestPaused") release(v.params.requestId);
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
const click = async (label) => {
  const p = await evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
};
await command("Page.bringToFront");
await command("Fetch.enable", {
  patterns: [{ urlPattern: "http://127.0.0.1:8874/api/product/askSettings", requestStage: "Response" }],
});
try {
  await click("从记忆生成");
  const requestId = await Promise.race([
    held,
    pause(12000).then(() => {
      throw Error("Ask settings response was not observed");
    }),
  ]);
  await click("开图");
  await click("足迹");
  await command("Fetch.continueResponse", { requestId });
  await pause(1200);
  const result = await evaluate(
    "({hiddenModal:!!document.querySelector('dialog:modal'),footprintCanvas:!!document.querySelector('.maplibregl-canvas'),askHidden:document.querySelector('textarea[aria-label=给开图发消息]')?.closest('[hidden]')!==null})",
  );
  if (result.hiddenModal || !result.footprintCanvas) throw Error("Hidden Ask setup modal blocked footprints");
  await click("城市与工具");
  result.listOpened = await evaluate(
    "getComputedStyle(document.querySelector('section[aria-label=城市列表]')).display!=='none'",
  );
  await click("关闭");
  writeFileSync(
    "docs/acceptance/footprint-step1-2026-10-20/product/hidden-ask-modal.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result));
} finally {
  await command("Fetch.disable");
  socket.close();
}
