import {
  type Card,
  type Locale,
  blankCard,
  cardPrompt,
  dimensions,
  labels,
  parseCard,
  roleLabels,
  sampleCard,
} from "./card.js";
import { escapeHtml as e, exportPng, mapSvg } from "./map.js";
import { type Choice, type Run, type World, choices, simulate } from "./simulation.js";

let locale: Locale = "zh";
let page: "home" | "import" | "review" | "play" = "home";
let card: Card = blankCard();
let choice: Choice = "learn";
let world: World = "everyday";
let worldSeed = seed();
let lifeSeed = seed();
let sampleIndex = 0;
let pasted = "";
let error = "";
let run: Run | null = null;
let revealed = 0;
let selected = 0;
let checkpoint = false;
function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
}
const root = required<HTMLDivElement>("#app");
const t = (zh: string, en: string) => (locale === "zh" ? zh : en);
const pair = (value: readonly [string, string]) => value[locale === "zh" ? 0 : 1];
function seed() {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase();
}
function option(value: string, label: string, current: string) {
  return `<option value="${e(value)}"${value === current ? " selected" : ""}>${e(label)}</option>`;
}
function button(id: string, label: string, cls = "") {
  return `<button type="button" id="${id}" class="${cls}">${label}</button>`;
}
function status() {
  return `<p class="error" role="alert">${e(error)}</p>`;
}
function header() {
  return `<header><button type="button" id="home" class="brand"><span class="brand-icon">开</span><span>开图 <b>KAITU</b></span></button><div class="header-right"><span class="edition">${t("人生往后推 / 原型 01", "THE NEXT CHAPTER / 01")}</span>${button("language", locale === "zh" ? "EN" : "中文", "quiet")}</div></header>`;
}
function home() {
  return `<main class="welcome"><section class="intro"><div class="eyebrow">${t("如果，只改变一件事", "WHAT IF ONE THING CHANGED")}</div><h1>${t("人生的下一页，<br>还有别的写法。", "Your next chapter.<br>A different way.")}</h1><p class="lead">${t("从此刻出发，看看十年后的两种可能。", "Begin here. Explore two possible paths over ten years.")}</p><div class="entry-actions">${button("random", `<span class="action-index">01</span><span>${t("随机人生", "A random life")}</span><span>↗</span>`, "entry primary")}${button("personal", `<span class="action-index">02</span><span>${t("用我的资料", "Use my profile")}</span><span>↗</span>`, "entry")}</div><div class="welcome-bottom"><span>${t("免登录 · 免安装", "No login · No installation")}</span>${button("load", t("载入开局", "Load a saved start"), "text-button")}<input type="file" id="load-file" accept=".json,application/json" hidden></div>${status()}</section><section class="hero-map">${mapSvg(null, 7, locale)}<div class="paper-note">${t("同一个世界<br>两条未走过的路", "One world<br>Two unwritten paths")}</div></section></main>`;
}
function importPage() {
  return `<main class="import-page"><div class="eyebrow">01 / ${t("带来角色卡", "BRING YOUR CHARACTER")}</div><h1>${t("从你开始。", "Begin with you.")}</h1><div class="import-grid"><section class="panel"><span class="step-number">1</span><h2>${t("去常用的 AI", "Go to your AI")}</h2><div class="ai-list"><span>ChatGPT</span><span>Claude</span><span>Gemini</span></div>${button("copy-prompt", t("复制角色卡提示词", "Copy character prompt"), "primary")}<details id="prompt-details"><summary>${t("查看提示词", "View prompt")}</summary><textarea id="prompt" readonly aria-label="${t("角色卡提示词", "Character prompt")}">${e(cardPrompt(locale))}</textarea></details></section><section class="panel"><span class="step-number">2</span><h2>${t("把角色卡带回来", "Bring the card back")}</h2><label for="paste">${t("粘贴 AI 生成的 JSON", "Paste the JSON from your AI")}</label><textarea id="paste" placeholder="JSON">${e(pasted)}</textarea>${status()}${button("parse", t("检查角色卡 →", "Review character →"), "primary")}${button("manual", t("自己填写", "Fill in myself"), "text-button")}</section></div></main>`;
}
function reviewPage() {
  const attributeFields = dimensions
    .map((key) => {
      const score = card.attributes[key];
      return `<div class="attribute-row"><label for="${key}">${pair(labels[key])}</label><select id="${key}" name="${key}">${option("", t("未知", "Unknown"), score.value === null ? "" : String(score.value))}${[1, 2, 3, 4, 5].map((value) => option(String(value), String(value), String(score.value))).join("")}</select><input name="source-${key}" aria-label="${pair(labels[key])}${t("依据", " source")}" value="${e(score.source)}" maxlength="160" placeholder="${t("依据 / 游戏设定", "Source / game setting")}"></div>`;
    })
    .join("");
  return `<main class="review-page"><div class="eyebrow">02 / ${t("这一页，由你落笔", "SET YOUR STARTING POINT")}</div><h1>${t("带上现在的你。", "Bring who you are today.")}</h1><form id="review-form"><div class="review-grid"><section class="panel"><div class="section-heading"><h2>${t("角色卡", "Character card")}</h2><span class="tag">${t("游戏设定", "Game settings")}</span></div><div class="field-row"><label>${t("昵称", "Alias")}<input name="name" value="${e(card.name)}" maxlength="24"></label><label>${t("当前年龄", "Current age")}<input name="age" type="number" min="0" max="110" required value="${card.age ?? ""}"></label></div><label>${t("当前状态", "Current role")}<select name="role">${Object.entries(
    roleLabels,
  )
    .map(([value, label]) => option(value, pair(label), card.role))
    .join(
      "",
    )}</select></label><label>${t("你想做的一件事", "Something you want to do")}<input name="project" maxlength="40" value="${e(card.project)}"></label><div class="attributes">${attributeFields}</div><details><summary>${t("规则与设定", "Rules and assumptions")}</summary><dl><dt>${t("未知项", "Unknown values")}</dt><dd>${t("界面保留未知；推演用中性档 3", "Remain unknown; simulation uses neutral level 3")}</dd><dt>${t("分值", "Scores")}</dt><dd>${t("1–5 的游戏设定", "Game settings from 1 to 5")}</dd><dt>${t("事件权重", "Event weights")}</dt><dd>${t("作者设定，非个人预测概率", "Authored assumptions, not personal probabilities")}</dd><dt>${t("资料", "Profile")}</dt><dd>${t("仅本页内存；关闭即清除", "In page memory; cleared on close")}</dd></dl></details></section><section class="choices-panel"><h2>${t("试着改变一件事", "Try one small change")}</h2><div class="choice-list">${Object.entries(
    choices,
  )
    .map(
      ([value, label], index) =>
        `<label class="choice"><input type="radio" name="choice" value="${value}"${choice === value ? " checked" : ""}><span class="choice-number">0${index + 1}</span><span>${pair(label)}</span></label>`,
    )
    .join(
      "",
    )}</div><h2>${t("故事的世界", "The world around you")}</h2><select name="world" aria-label="${t("故事的世界", "Story world")}">${option("everyday", t("日常世界", "Everyday world"), world)}${option("orbital", t("轨道来信 · 科幻", "Letters from orbit · Sci-fi"), world)}</select><details><summary>${t("同一开局", "Reproducible start")}</summary><label>${t("世界种子", "World seed")}<input name="worldSeed" maxlength="40" required value="${e(worldSeed)}"></label><label>${t("人生种子", "Life seed")}<input name="lifeSeed" maxlength="40" required value="${e(lifeSeed)}"></label></details>${status()}<button class="primary start" type="submit">${t("展开这十年 →", "Unfold ten years →")}</button></section></div></form></main>`;
}
function playPage() {
  if (!run) return "";
  const index = Math.max(0, selected - 1);
  const a = run.baseline[index];
  const b = run.changed[index];
  const finished = revealed === 10;
  const scores = (line: typeof a) =>
    dimensions
      .map(
        (key) =>
          `<span>${pair(labels[key])}<b>${card.attributes[key].value === null ? "?" : line.state.props[key].toFixed(1)}</b></span>`,
      )
      .join("");
  const story = (line: typeof a, changed: boolean) =>
    `<article class="story ${changed ? "changed" : ""}"><div class="story-heading"><span>${changed ? t("改变一件事", "One small change") : t("照现在过", "As things are")}</span><span class="story-stage">${line.state.props.STAGE}/5</span></div><p>${e(pair(line.text))}</p><div class="score-strip">${scores(line)}</div></article>`;
  const control =
    revealed === 5 && !checkpoint
      ? `<section class="checkpoint"><span class="eyebrow">${t("第五年 · 停一停", "YEAR FIVE · A PAUSE")}</span><h2>${t("接下来，还为它留时间吗？", "Keep making room for it?")}</h2>${button("continue", t("继续这个节奏", "Keep this rhythm"), "primary")}${button("loosen", t("让它慢下来", "Ease the commitment"), "quiet")}</section>`
      : finished
        ? `<section class="ending"><span class="eyebrow">${t("十年，一页暂告段落", "TEN YEARS, ONE CHAPTER")}</span><h2>${t("接下来的一步，<br>留给现实中的你。", "The next step<br>is yours to take.")}</h2><div class="ending-actions">${button("export", t("保存分叉图 PNG ↓", "Save map as PNG ↓"), "primary")}${button("save", t("保存开局", "Save start"), "quiet")}</div>${button("replay", t("同一开局，再选一次 ↗", "Same start, another choice ↗"), "text-button")}</section>`
        : `<div class="play-controls">${button("next", t("下一年 →", "Next year →"), "primary")}${button("skip", revealed < 5 ? t("看到第五年", "Go to year five") : t("看到十年后", "Go to the ending"), "quiet")}</div>`;
  return `<main class="play-page"><div class="play-top"><div><div class="eyebrow">${world === "orbital" ? t("科幻推演", "SCI-FI SCENARIO") : t("日常世界 · 推演", "EVERYDAY WORLD · SIMULATION")}</div><h1>${finished ? t("两条路，都曾是可能。", "Both paths were possible.") : t("如果，往前走十年。", "What if you walked ten years?")}</h1></div><span class="year-counter">${revealed}<small> / 10</small></span></div><div class="play-grid"><section class="map-panel">${mapSvg(run, revealed, locale)}</section><section class="narrative">${revealed === 0 ? `<div class="opening"><span class="eyebrow">${t("从今天开始", "BEGIN TODAY")}</span><h2>${e(card.name || t("你", "You"))} · ${card.age}${t(" 岁", " years old")}</h2><p>${e(pair(choices[choice]))}</p></div>` : `<div class="year-heading"><span>${a.year}</span><span>${a.age}${t(" 岁", " years old")}</span></div><p class="world-event">${e(pair(a.world))}</p>${story(a, false)}${story(b, true)}`}${control}${status()}${revealed ? `<nav class="year-nav" aria-label="${t("已推演的年份", "Years explored")}">${Array.from({ length: revealed }, (_, i) => `<button type="button" data-year="${i + 1}"${selected === i + 1 ? ' aria-current="step"' : ""}>${i + 1}</button>`).join("")}</nav>` : ""}</section></div></main>`;
}
function readReview() {
  const form = document.querySelector<HTMLFormElement>("#review-form");
  if (!form) return;
  const data = new FormData(form);
  const raw = {
    ...card,
    name: data.get("name"),
    age: data.get("age") === "" ? null : Number(data.get("age")),
    role: data.get("role"),
    project: data.get("project"),
    attributes: Object.fromEntries(
      dimensions.map((key) => [
        key,
        { value: data.get(key) === "" ? null : Number(data.get(key)), source: data.get(`source-${key}`) },
      ]),
    ),
  };
  card = parseCard(JSON.stringify(raw));
  choice = data.get("choice") as Choice;
  world = data.get("world") as World;
  worldSeed = String(data.get("worldSeed") || "").trim();
  lifeSeed = String(data.get("lifeSeed") || "").trim();
}
function click(id: string, fn: () => void | Promise<void>) {
  document.getElementById(id)?.addEventListener("click", () => {
    Promise.resolve()
      .then(fn)
      .catch((reason) => {
        error = reason instanceof Error ? reason.message : String(reason);
        render();
      });
  });
}
function downloadStart() {
  if (!run) return;
  const blob = new Blob(
    [JSON.stringify({ kind: "kaitu-simulation", version: 1, config: run.config }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kaitu-start.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  root.innerHTML = `${header() + (page === "home" ? home() : page === "import" ? importPage() : page === "review" ? reviewPage() : playPage())}<footer><span>KAITU © 2026</span><span>${t("这是推演，不是预测", "A simulation, not a prediction")}</span><a href="./vendor/remake/LICENSE" target="_blank" rel="noreferrer">Remake · MIT</a></footer>`;
  click("home", () => {
    page = "home";
    error = "";
    render();
  });
  click("language", () => {
    readReview();
    pasted = document.querySelector<HTMLTextAreaElement>("#paste")?.value ?? pasted;
    locale = locale === "zh" ? "en" : "zh";
    render();
  });
  click("random", () => {
    card = sampleCard(sampleIndex++, locale);
    worldSeed = seed();
    lifeSeed = seed();
    page = "review";
    error = "";
    render();
  });
  click("personal", () => {
    page = "import";
    error = "";
    render();
  });
  click("manual", () => {
    card = blankCard();
    page = "review";
    error = "";
    render();
  });
  document.querySelector("#paste")?.addEventListener("input", (event) => {
    pasted = (event.target as HTMLTextAreaElement).value;
  });
  click("parse", () => {
    card = parseCard(pasted);
    page = "review";
    error = "";
    render();
  });
  click("copy-prompt", async () => {
    try {
      await navigator.clipboard.writeText(cardPrompt(locale));
      required<HTMLButtonElement>("#copy-prompt").textContent = t("已复制 ✓", "Copied ✓");
    } catch {
      const details = required<HTMLDetailsElement>("#prompt-details");
      details.open = true;
      document.querySelector<HTMLTextAreaElement>("#prompt")?.select();
    }
  });
  document.querySelector("#review-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      readReview();
      if (!worldSeed || !lifeSeed) throw new Error(t("请填写两个种子", "Enter both seeds"));
      run = simulate({ card, choice, world, worldSeed, lifeSeed, year: new Date().getUTCFullYear() });
      revealed = 0;
      selected = 0;
      checkpoint = false;
      page = "play";
      error = "";
      render();
      window.scrollTo(0, 0);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
      render();
    }
  });
  const reveal = (n: number) => {
    revealed = n;
    selected = n;
    error = "";
    render();
  };
  click("next", () => reveal(Math.min(10, revealed + 1)));
  click("skip", () => reveal(revealed < 5 ? 5 : 10));
  for (const id of ["continue", "loosen"])
    click(id, () => {
      if (!run) return;
      checkpoint = true;
      run = simulate({ ...run.config, secondHalf: id === "continue" });
      selected = 5;
      render();
    });
  click("replay", () => {
    page = "review";
    error = "";
    render();
    window.scrollTo(0, 0);
  });
  click("export", async () => {
    await exportPng(mapSvg(run, 10, locale, true));
    required<HTMLButtonElement>("#export").textContent = t("已导出 PNG ✓", "PNG exported ✓");
  });
  click("save", downloadStart);
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-year]"))
    btn.addEventListener("click", () => {
      selected = Number(btn.dataset.year);
      render();
    });
  click("load", () => document.getElementById("load-file")?.click());
  document.querySelector("#load-file")?.addEventListener("change", async (event) => {
    try {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 20000) throw new Error(t("开局文件超过 20 KB", "Saved start exceeds 20 KB"));
      const saved = JSON.parse(await file.text());
      const c = saved.config;
      if (
        saved.kind !== "kaitu-simulation" ||
        saved.version !== 1 ||
        !c ||
        !Object.hasOwn(choices, c.choice) ||
        !["everyday", "orbital"].includes(c.world) ||
        !Number.isInteger(c.year) ||
        c.year < 1900 ||
        c.year > 2200 ||
        [c.worldSeed, c.lifeSeed].some((s) => typeof s !== "string" || !s.trim() || s.length > 40) ||
        (c.secondHalf !== undefined && typeof c.secondHalf !== "boolean")
      )
        throw new Error(t("无法读取这个开局文件", "This saved start is invalid"));
      card = parseCard(JSON.stringify(c.card));
      choice = c.choice;
      world = c.world;
      worldSeed = c.worldSeed;
      lifeSeed = c.lifeSeed;
      run = simulate({ card, choice, world, worldSeed, lifeSeed, year: c.year, secondHalf: c.secondHalf });
      page = "play";
      revealed = 10;
      selected = 10;
      checkpoint = true;
      error = "";
      render();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
      render();
    }
  });
}
render();
