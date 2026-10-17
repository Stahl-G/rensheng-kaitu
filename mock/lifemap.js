/*
 * 灵感来源旁边的「人生进度图」概念设计（开图还没有这个功能，这里只是示意）。
 * Concept of a clickable life progress map shown next to the inspiration story. Not a shipped feature.
 *
 * 人物和 persona.js 里的「小林」是同一个人，资料均为合成。改这里的 nodes 就能改图。
 * x / y 是在 440×480 画布上的位置；kind: past 走过的路，now 现在，active 正在推进，fog 还没探索。
 */
(() => {
  const root = document.querySelector("[data-lifemap]");
  if (!root) return;
  const lang = root.dataset.lang === "en" ? "en" : "zh";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const W = 440;
  const H = 480;

  const AREA = { me: "--me", health: "--health", doing: "--doing", explore: "--explore", fog: "--muted" };
  const T = {
    zh: {
      title: "小林的人生进度图",
      badge: "概念设计 · 开发中",
      persona: "虚构示例人物，资料均为合成",
      legend: ["走过的路", "正在推进", "还没探索"],
      hint: "点地图上的点看看。实线是走过的路，虚线是正在推进的事，雾里是还没探索的地方。",
      area: { me: "经历", health: "健康", doing: "在做的事", explore: "方向", fog: "迷雾" },
      evidence: "依据",
      next: "下一步",
      tryIt: "试这一步，点亮这块地图",
      tried: "已采纳为一次尝试，结果回来后会更新这块地图。",
    },
    en: {
      title: "Xiao Lin’s life progress map",
      badge: "Concept · in development",
      persona: "Fictional example person, synthetic data",
      legend: ["Road behind", "In progress", "Unexplored"],
      hint: "Tap a point on the map. Solid lines are the road behind, dashed lines are what’s in progress, and the fog is what hasn’t been explored yet.",
      area: { me: "Experience", health: "Health", doing: "Projects", explore: "Directions", fog: "Fog" },
      evidence: "Evidence",
      next: "Next step",
      tryIt: "Try this step and light up the map",
      tried: "Taken on as a trial. This part of the map updates when the result comes in.",
    },
  }[lang];

  const nodes = [
    { id: "p1", kind: "past", area: "me", x: 64, y: 432,
      zh: { label: "南京读书", when: "2015", body: "在南京读完大学，学的是信息管理。", evidence: "经历：南京 · 读书" },
      en: { label: "Studied in Nanjing", when: "2015", body: "Finished university in Nanjing, majoring in information management.", evidence: "Experience: Nanjing · studied" } },
    { id: "p2", kind: "past", area: "me", x: 146, y: 372,
      zh: { label: "来上海做产品", when: "2019", body: "到上海做产品经理，到现在第 5 年。", evidence: "经历：上海 · 工作；ChatGPT 导入的记忆" },
      en: { label: "Product job in Shanghai", when: "2019", body: "Moved to Shanghai as a product manager, now in year five.", evidence: "Experience: Shanghai · work; memory imported from ChatGPT" } },
    { id: "p3", kind: "past", area: "health", x: 206, y: 306,
      zh: { label: "把训练目标搬进来", when: "10/03", body: "把和 ChatGPT 聊过的「重新开始训练」搬进开图，定成一个目标。", evidence: "从 ChatGPT 搬来 · 10/03" },
      en: { label: "Brought in a training goal", when: "Oct 3", body: "Moved the “get back into training” talks with ChatGPT into Kaitu and made it a goal.", evidence: "Brought in from ChatGPT · Oct 3" } },
    { id: "now", kind: "now", area: "me", x: 236, y: 236,
      zh: { label: "现在", when: "10/17", body: "两件事在推进，两个方向在试，还有一块没去过的地方。", evidence: "今天页：现在最该做的是腿部训练" },
      en: { label: "Now", when: "Oct 17", body: "Two things in progress, two directions being tried, and one place not yet explored.", evidence: "Today: the most important thing now is leg day" } },
    { id: "g1", kind: "active", area: "health", x: 96, y: 150,
      zh: { label: "连续 12 周规律训练", when: "第 3 周", body: "本周已练 2 次，离每周 3 次还差 1 次。深蹲从 55 kg 加到 60 kg。", evidence: "训练记录 · Apple 健康", next: "今晚 18:00 腿部训练：深蹲 3×12" },
      en: { label: "Train regularly for 12 weeks", when: "Week 3", body: "Two sessions this week, one short of three. Squat went from 55 kg to 60 kg.", evidence: "Workout log · Apple Health", next: "Leg day tonight at 18:00: squats 3×12" } },
    { id: "g2", kind: "active", area: "doing", x: 360, y: 196,
      zh: { label: "记账小程序", when: "业余项目", body: "需求理清了，还没开始画界面。", evidence: "项目：记账小程序", next: "画首页草图" },
      en: { label: "Budgeting mini-app", when: "Side project", body: "Requirements are clear; the screens are not started yet.", evidence: "Project: budgeting mini-app", next: "Sketch the home screen" } },
    { id: "d1", kind: "active", area: "explore", x: 372, y: 336,
      zh: { label: "要不要搬去杭州", when: "在试", body: "周末去杭州看了两套房，都在预算内；早高峰地铁 35 分钟，支持假设。", evidence: "尝试记录 · 资讯：杭州和上海的通勤对比", next: "投三家杭州公司的产品岗，看回复" },
      en: { label: "Move to Hangzhou?", when: "Trying", body: "Saw two flats in Hangzhou, both within budget; the rush-hour metro took 35 minutes. Supports the hypothesis.", evidence: "Trial log · News: Hangzhou vs Shanghai commute", next: "Apply to three product roles in Hangzhou and see who replies" } },
    { id: "d2", kind: "active", area: "explore", x: 62, y: 268,
      zh: { label: "每周加一次慢跑", when: "在试", body: "力量训练稳定了，想补一点有氧。10/10 跑了第一次 5 公里。", evidence: "Apple 健康：跑步 5 公里 · 10/10", next: "每周六早上跑 5 公里" },
      en: { label: "Add a weekly run", when: "Trying", body: "Strength training is steady; adding some cardio. First 5 km run on Oct 10.", evidence: "Apple Health: 5 km run · Oct 10", next: "Run 5 km every Saturday morning" } },
    { id: "f1", kind: "fog", area: "fog", x: 262, y: 84, explorable: true,
      zh: { label: "副业能养活自己吗？", when: "没探索过", body: "想过，但没有任何记录。开图建议先试一小步，看看结果再说。", evidence: "还没有", next: "把记账小程序给 10 个朋友试用，看两周后有几个人还在用" },
      en: { label: "Could the side project pay?", when: "Unexplored", body: "Thought about, but nothing recorded. Kaitu suggests a small step first and deciding after the result.", evidence: "None yet", next: "Give the mini-app to 10 friends and see how many still use it after two weeks" } },
    { id: "f2", kind: "fog", area: "fog", x: 96, y: 46,
      zh: { label: "？", when: "迷雾", body: "这里还没有记录，也没想过。等有了新的问题或想法，会出现在这里。", evidence: "还没有" },
      en: { label: "?", when: "Fog", body: "Nothing recorded here, nothing considered yet. New questions and ideas show up here.", evidence: "None yet" } },
    { id: "f3", kind: "fog", area: "fog", x: 404, y: 62,
      zh: { label: "？", when: "迷雾", body: "这里还没有记录，也没想过。等有了新的问题或想法，会出现在这里。", evidence: "还没有" },
      en: { label: "?", when: "Fog", body: "Nothing recorded here, nothing considered yet. New questions and ideas show up here.", evidence: "None yet" } },
  ];
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const route = ["p1", "p2", "p3", "now"].map((id) => at[id]);
  const branches = ["g1", "g2", "d1", "d2"];
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const curve = (a, b) => {
    const mx = (a.x + b.x) / 2;
    return `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
  };

  root.innerHTML = `
    <div class="lm-head"><b>${T.title}</b><span class="chip lm-badge">${T.badge}</span></div>
    <div class="lm-stage"></div>
    <ul class="lm-legend" aria-hidden="true"><li><i class="lm-k-past"></i>${T.legend[0]}</li><li><i class="lm-k-active"></i>${T.legend[1]}</li><li><i class="lm-k-fog"></i>${T.legend[2]}</li></ul>
    <div class="lm-card" aria-live="polite"></div>
    <p class="lm-foot">${T.persona}</p>`;
  const stage = root.querySelector(".lm-stage");
  const card = root.querySelector(".lm-card");

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "lm-svg", "aria-hidden": "true" }, stage);
  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "lm-hatch", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 8, class: "lm-hatch" }, pat);
  const grad = el("radialGradient", { id: "lm-clear" }, defs);
  el("stop", { offset: "55%", "stop-color": "#000" }, grad);
  el("stop", { offset: "100%", "stop-color": "#fff" }, grad);
  const mask = el("mask", { id: "lm-mask", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H }, defs);
  el("rect", { width: W, height: H, fill: "#fff" }, mask);
  const holes = {};
  for (const n of nodes) if (n.kind !== "fog") holes[n.id] = el("circle", { cx: n.x, cy: n.y, r: n.kind === "past" ? 70 : 84, fill: "url(#lm-clear)" }, mask);

  // 底图：淡网格
  const grid = el("g", { class: "lm-grid" }, svg);
  for (let x = 40; x < W; x += 40) el("line", { x1: x, y1: 0, x2: x, y2: H }, grid);
  for (let y = 40; y < H; y += 40) el("line", { x1: 0, y1: y, x2: W, y2: y }, grid);

  // 路线
  const lines = el("g", { class: "lm-lines" }, svg);
  const past = el("path", { class: "lm-route", d: route.slice(1).reduce((d, n, i) => d + curve(route[i], n).slice(curve(route[i], n).indexOf("C") - 1), `M${route[0].x} ${route[0].y}`) }, lines);
  const dashes = {};
  for (const id of branches) dashes[id] = el("path", { class: `lm-branch lm-a-${at[id].area}`, d: curve(at.now, at[id]) }, lines);
  dashes.f1 = el("path", { class: "lm-branch lm-faint", d: curve(at.g2, at.f1) }, lines);

  // 迷雾
  const fog = el("g", { class: "lm-fog", mask: "url(#lm-mask)" }, svg);
  el("rect", { width: W, height: H, class: "lm-fog-fill" }, fog);
  el("rect", { width: W, height: H, fill: "url(#lm-hatch)" }, fog);

  // 地点按钮
  const buttons = {};
  for (const n of nodes) {
    const d = n[lang];
    const b = document.createElement("button");
    b.type = "button";
    b.className = `lm-node lm-${n.kind}`;
    b.style.left = `${(n.x / W) * 100}%`;
    b.style.top = `${(n.y / H) * 100}%`;
    b.style.setProperty("--c", `var(${AREA[n.area]})`);
    b.setAttribute("aria-label", `${d.label}，${d.when}`.replace("，", lang === "en" ? ", " : "，"));
    b.innerHTML = `<span class="lm-dot">${n.kind === "fog" ? "?" : ""}</span><span class="lm-label">${d.label === "？" || d.label === "?" ? "" : d.label}</span>`;
    b.addEventListener("click", () => select(n.id));
    stage.appendChild(b);
    buttons[n.id] = b;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function select(id) {
    const n = at[id];
    const d = n[lang];
    for (const [k, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", String(k === id));
    const area = n.kind === "fog" && n.explored ? T.area.explore : T.area[n.area];
    card.innerHTML = `
      <div class="lm-card-top"><span class="lm-chip" style="--c: var(${AREA[n.explored ? "explore" : n.area]})">${area}</span><span class="lm-when">${esc(n.explored ? (lang === "en" ? "Trying" : "在试") : d.when)}</span></div>
      <h3>${esc(d.label === "？" || d.label === "?" ? T.area.fog : d.label)}</h3>
      <p>${esc(n.explored ? T.tried : d.body)}</p>
      <dl>${d.evidence ? `<div><dt>${T.evidence}</dt><dd>${esc(d.evidence)}</dd></div>` : ""}${d.next ? `<div><dt>${T.next}</dt><dd>${esc(d.next)}</dd></div>` : ""}</dl>
      ${n.explorable && !n.explored ? `<button type="button" class="btn btn-primary lm-try">${T.tryIt}</button>` : ""}`;
    const tryBtn = card.querySelector(".lm-try");
    if (tryBtn) tryBtn.addEventListener("click", () => explore(n));
  }

  function explore(n) {
    n.explored = true;
    n.area = "explore";
    const b = buttons[n.id];
    b.classList.remove("lm-fog");
    b.querySelector(".lm-dot").textContent = "";
    b.classList.add("lm-active");
    b.style.setProperty("--c", "var(--explore)");
    dashes.f1.setAttribute("class", "lm-branch lm-a-explore");
    const hole = el("circle", { cx: n.x, cy: n.y, r: still ? 84 : 0, fill: "url(#lm-clear)" }, mask);
    holes[n.id] = hole;
    if (!still) {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 900);
        hole.setAttribute("r", String(84 * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    select(n.id);
    b.focus();
  }

  card.innerHTML = `<p class="lm-hint">${T.hint}</p>`;

  // 进入视野时画路线
  if (!still && "IntersectionObserver" in window) {
    root.classList.add("lm-pre");
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      root.classList.remove("lm-pre");
      root.classList.add("lm-play");
    }, { threshold: 0.3 });
    io.observe(root);
  }
  past.style.setProperty("--len", String(Math.ceil(past.getTotalLength())));
})();
