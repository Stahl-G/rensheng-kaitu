/* 首页可点击示例：从 persona.js 的 window.KAITU_MOCK 渲染。没有 JS 时页面里保留静态说明。 */
(() => {
  const root = document.querySelector("[data-mock]");
  const D = window.KAITU_MOCK;
  if (!root || !D) return;
  const lang = root.dataset.lang === "en" ? "en" : "zh";
  const L = D[lang];
  const U = L.ui;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let saved = 1;

  const mark = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="mm-a"><path d="M4 10L17.33 6L17.33 38L4 42Z"/><path d="M17.33 6L30.67 10L30.67 42L17.33 38Z"/></clipPath><clipPath id="mm-b"><path d="M30.67 10L44 6L44 38L30.67 42Z"/></clipPath></defs><path class="mk-face mk-f0" d="M4 10L17.33 6L17.33 38L4 42Z"/><path class="mk-face mk-f1" d="M17.33 6L30.67 10L30.67 42L17.33 38Z"/><path class="mk-face mk-f2" d="M30.67 10L44 6L44 38L30.67 42Z"/><g clip-path="url(#mm-a)"><path class="mk-route mk-rf" d="M8.5 34C11 31 14 28 17.33 26.5C21 25 26 31 30.67 29.5C34 28 36.5 22 39.5 16"/></g><g clip-path="url(#mm-b)"><path class="mk-route mk-ro" d="M8.5 34C11 31 14 28 17.33 26.5C21 25 26 31 30.67 29.5C34 28 36.5 22 39.5 16"/></g></svg>`;
  const tick = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /* ---------- 今天 ---------- */
  const T = L.today;
  const today = () => `
    <div class="m-content">
      <div class="m-head"><h3 class="m-h1">${esc(T.date)}</h3></div>
      <form class="m-capture" data-capture>
        <label class="sr-only" for="m-cap-${lang}">${esc(U.captureLabel)}</label>
        <input id="m-cap-${lang}" autocomplete="off" maxlength="200" placeholder="${esc(U.capturePh)}">
        <button type="submit" class="btn m-strong" disabled>${esc(U.captureBtn)}</button>
      </form>
      <ul class="m-saved" data-saved aria-live="polite"></ul>
      <section class="m-sec">
        <h4 class="eyebrow">${esc(U.focusEyebrow)}</h4>
        <div class="m-focus card" data-focus>
          <div class="m-focus-body"><p class="m-focus-title">${esc(T.focus.title)}</p><p class="m-sub">${esc(U.from(T.focus.module))}</p></div>
          <div class="m-acts"><button type="button" class="btn btn-primary" data-focus-done aria-pressed="false">${esc(U.done)}</button><span class="m-link">${esc(U.schedule)}</span><span class="btn btn-primary m-static">${esc(U.askHelp)}</span></div>
        </div>
        ${T.next.map((n, i) => `
        <div class="m-row card" data-row>
          <button type="button" class="m-check" aria-pressed="false" aria-label="${esc(U.done)}: ${esc(n.title)}" data-check>${tick}</button>
          <span class="m-row-title">${esc(n.title)}</span>
          <span class="m-row-meta"><span class="m-chip">${esc(n.module)}</span><span class="m-link">${esc(U.schedule)}</span><span class="m-link">${esc(U.askHelp)}</span></span>
        </div>`).join("")}
        <p class="m-link m-more">▸ ${esc(U.allNext(T.allNext))}</p>
      </section>
      <section class="m-sec">
        <div class="m-sec-head"><h4 class="eyebrow">${esc(U.plansEyebrow)}</h4><span class="m-sub">${esc(U.goals(T.plans.length))}</span></div>
        ${T.plans.map((p) => `
        <div class="card m-plan" data-hl="plans">
          <div class="m-plan-main"><b>${esc(p.title)}</b><span class="m-sub">${esc(p.origin)}</span></div>
          <div class="m-plan-next"><span>${esc(U.nextPrefix)}${esc(p.next)}</span><span class="m-acts"><span class="btn btn-quiet m-static">${esc(U.done)}</span><span class="btn btn-quiet m-static">${esc(U.later)}</span></span></div>
        </div>`).join("")}
        <p class="m-link">${esc(U.projectsLink(T.projects))}</p>
      </section>
      <section class="m-sec">
        <div class="m-sec-head"><h4 class="eyebrow">${esc(U.agendaEyebrow)}</h4><span class="m-link">${esc(U.fullSchedule)}</span></div>
        <div class="card m-agenda">
          ${T.agenda.map((a) => `
          <div class="m-agenda-row"${a.pending ? " data-pending" : ""}>
            <time class="num">${esc(a.time)}</time>
            <span>${esc(a.title)}${a.pending ? `<span class="m-sub">${esc(U.pending)}</span>` : ""}</span>
            ${a.pending ? `<span class="m-acts" data-pending-acts><button type="button" class="m-confirm" data-confirm>${esc(U.confirm)}</button><button type="button" class="m-nothanks" data-dismiss>${esc(U.noThanks)}</button></span>` : `<span class="m-sub">${esc(a.src)}</span>`}
          </div>`).join("")}
        </div>
      </section>
    </div>`;

  /* ---------- 开图 ---------- */
  const H = L.health;
  const weeks = (cls = "") =>
    `<div class="weeks ${cls}">${U.weekdays.map((d) => `<span class="wd">${esc(d)}</span>`).join("")}${D.weeks
      .map((w, r) => [...w].map((c, d) => `<i style="--w:${r};--d:${d}" ${c === "f" ? "data-future" : `data-l="${c}"`}></i>`).join(""))
      .join("")}</div>`;
  const stats = (list) => `<div class="m-stats">${list.map((s) => `<div class="m-stat"><span class="m-sub">${esc(s.label)}</span><strong>${esc(s.value)}</strong><span class="m-sub">${esc(s.note)}</span></div>`).join("")}</div>`;
  const health = () => `
    <div class="m-modhead">
      <div><h4 class="m-modtitle"><i class="m-dot" style="background:var(--health)"></i>${esc(U.subs.health)}</h4><p class="m-sub">${esc(U.healthSubtitle)}</p></div>
      <span class="btn btn-primary m-static">${esc(U.logWorkout)}</span>
    </div>
    <div class="m-tertiary" role="group" aria-label="${esc(U.subs.health)}">
      <button type="button" aria-pressed="true" data-htab="training">${esc(U.healthTabs.training)}</button>
      <button type="button" aria-pressed="false" data-htab="meals">${esc(U.healthTabs.meals)}</button>
    </div>
    <div data-hpanel="training">
      ${stats(H.stats)}
      <div class="card m-heat"><div class="m-sec-head"><b>${esc(U.last5)}</b><span class="m-sub">${esc(U.last5Note)}</span></div>${weeks()}</div>
      <section class="m-sec"><h4 class="eyebrow">${esc(U.recentWorkouts)}</h4>
        <div class="card m-list">${H.workouts.map((w) => `<div class="m-li"${w.hl ? ` data-hl="${w.hl}"` : ""}><time class="num m-sub">${esc(w.date)}</time><span>${esc(w.title)}</span><span class="m-sub">${esc(w.src)}</span></div>`).join("")}</div>
      </section>
    </div>
    <div data-hpanel="meals" hidden>
      ${stats(H.mealStats)}
      <section class="m-sec"><h4 class="eyebrow">${esc(U.recentMeals)}</h4>
        <div class="card m-list">${H.meals.map((m) => `<div class="m-li"><time class="num m-sub">${esc(m.date)}</time><span>${esc(m.title)}</span><span class="m-sub">${esc(m.note)}</span></div>`).join("")}</div>
      </section>
    </div>
    <section class="m-sec"><h4 class="eyebrow">${esc(U.healthNext)}</h4><div class="card m-list"><div class="m-li m-li2"><span>${esc(H.next)}</span><span class="m-sub">${esc(U.healthGoal)}：${esc(H.goal)}</span></div></div></section>`;

  const M = D.map;
  const F = L.footprints;
  const footprints = () => {
    const [x0, y0, x1, y1] = M.box;
    const W = 600, Hh = 320;
    const px = (c) => [((c.lon - x0) / (x1 - x0)) * W, ((y1 - c.lat) / (y1 - y0)) * Hh];
    const pts = M.cities.map(px);
    const lines = pts.slice(1).map((p, i) => {
      const a = pts[i];
      const mx = (a[0] + p[0]) / 2, my = (a[1] + p[1]) / 2 - 26;
      const planned = M.cities[i + 1].kind === "planned";
      return `<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}" class="m-route${planned ? " is-planned" : ""}"/>`;
    }).join("");
    const dots = M.cities.map((c, i) => {
      const [x, y] = pts[i];
      const name = F.cities[c.id].name;
      const anchor = x > W - 90 ? "end" : "start";
      const dx = anchor === "end" ? -12 : 12;
      return `<g class="m-city is-${c.kind}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${c.kind === "home" ? 7 : 6}"/><text x="${(x + dx).toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="${anchor}">${esc(name)}</text></g>`;
    }).join("");
    return `
    <div class="m-modhead"><div><h4 class="m-modtitle"><i class="m-dot" style="background:var(--explore)"></i>${esc(U.subs.footprints)}</h4><p class="m-sub">${esc(F.intro)}</p></div></div>
    <figure class="card m-map">
      <svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(U.mapNote)}">
        <path class="m-sea" d="M${W} 0V${Hh}H520C540 280 560 250 548 222C536 196 566 176 560 150C552 118 580 92 572 60C566 32 590 14 586 0Z"/>
        <path class="m-river" d="M0 210C80 196 120 150 190 160C250 168 290 140 330 150C390 166 430 168 470 176C500 182 530 176 552 170"/>
        ${lines}${dots}
      </svg>
      <figcaption class="m-sub">${esc(U.mapNote)}</figcaption>
    </figure>
    <div class="card m-list">${M.cities.map((c) => `<div class="m-li"><span class="m-kind is-${c.kind}">${esc(U.kinds[c.kind])}</span><span>${esc(F.cities[c.id].name)}</span><span class="m-sub">${esc(F.cities[c.id].years)}</span></div>`).join("")}</div>`;
  };

  const news = () => `
    <div class="m-sec-head"><h4 class="eyebrow">${esc(U.newsEyebrow)}</h4><span class="m-link">${esc(U.newsRules)}</span></div>
    ${L.news.map((n) => `
    <article class="card m-news">
      <div class="m-thumb" aria-hidden="true">${lang === "en" ? "A" : "文"}</div>
      <div class="m-news-body">
        <p class="m-sub">${esc(n.meta)}</p>
        <h5 class="m-news-title">${esc(n.title)}</h5>
        <p class="m-ink2">${esc(n.summary)}</p>
        <div class="m-news-foot">
          <span class="m-related">${esc(U.related)}${esc(n.related)}</span><span class="m-link">${esc(U.addNext)}</span>
          <span class="m-fb"><button type="button" class="m-pill" aria-pressed="false" data-fb>${esc(U.useful)}</button><button type="button" class="m-pill" aria-pressed="false" data-fb>${esc(U.irrelevant)}</button></span>
        </div>
      </div>
    </article>`).join("")}`;

  const directions = () => `
    <div class="m-sec-head m-dir-head"><h4 class="eyebrow">${esc(U.dirEyebrow)}</h4><span class="m-acts"><span class="btn btn-quiet m-static">${esc(U.dirAsk)}</span><span class="m-link">${esc(U.dirOwn)}</span><span class="m-link">${esc(U.dirNew)}</span></span></div>
    ${L.directions.map((d, i) => `
    <article class="m-dir"${d.detail ? ' data-hl="direction"' : ""}>
      <div class="m-dir-main">
        <p class="m-dir-tags"><span class="m-chip">${esc(d.state)}</span>${d.saved ? `<span class="m-sub">${esc(U.saved)}</span>` : ""}</p>
        <h5 class="m-dir-title">${esc(d.title)}</h5>
        <p class="m-ink2">${esc(d.motivation)}</p>
        <p class="m-first"><span class="m-sub">${esc(U.firstStep)}</span> ${esc(d.first)}</p>
      </div>
      <div class="m-acts"><span class="m-link">${esc(U.pause)}</span>${d.detail ? `<button type="button" class="linkbtn" aria-expanded="false" aria-controls="m-dd-${lang}-${i}" data-detail>${esc(U.details)}</button>` : `<span class="m-link">${esc(U.details)}</span>`}</div>
      ${d.detail ? `
      <div class="m-dir-detail" id="m-dd-${lang}-${i}" hidden>
        <h6>${esc(U.why)}</h6><p>${esc(d.motivation)}</p>
        <h6>${esc(U.hypothesis)}</h6><p>${esc(d.detail.hypothesis)}</p>
        <h6>${esc(U.unknown)}</h6><p>${esc(d.detail.unknown)}</p>
        <h6>${esc(U.evidence)}</h6>
        <ul>${d.detail.evidence.map((e) => `<li><span class="m-chip ${/反面|Against/.test(e.stance) ? "is-against" : "is-for"}">${esc(e.stance)}</span> ${esc(e.text)}</li>`).join("")}</ul>
        <h6>${esc(U.attempts)}</h6>
        ${d.detail.attempts.map((a) => `<div class="m-attempt"><b>${esc(a.action)}</b><p class="m-sub">${esc(a.state)}</p>${a.result ? `<p>${esc(a.result)}</p>` : ""}</div>`).join("")}
      </div>` : ""}
    </article>`).join("")}`;

  const explore = () => `
    <div class="m-content">
      <div class="m-head"><h3 class="m-h1">${esc(U.exploreTitle)}</h3></div>
      <div class="m-subs" role="group" aria-label="${esc(U.subNav)}">
        ${Object.entries(U.subs).map(([id, name], i) => `<button type="button" aria-pressed="${i === 0}" data-sub="${id}">${esc(name)}</button>`).join("")}
      </div>
      <div data-subpanel="health">${health()}</div>
      <div data-subpanel="footprints" hidden>${footprints()}</div>
      <div data-subpanel="news" hidden>${news()}</div>
      <div data-subpanel="directions" hidden>${directions()}</div>
    </div>`;

  /* ---------- 资料 ---------- */
  const B = L.library;
  const colors = { calendar: "var(--news)", projects: "var(--doing)", health: "var(--health)", finance: "var(--finance)", notes: "var(--explore)", inbox: "var(--me)" };
  const library = () => `
    <div class="m-content">
      <div class="m-head"><h3 class="m-h1">${esc(U.libraryTitle)}</h3></div>
      <div class="m-cards">${B.cards.map((c) => `<div class="card m-libcard"><p class="m-libname"><i class="m-dot" style="background:${colors[c.id]}"></i>${esc(c.name)}</p>${c.value ? `<strong>${esc(c.value)}</strong>` : ""}<p class="m-sub">${esc(c.note)}</p></div>`).join("")}</div>
      <section class="m-sec"><h4 class="eyebrow">${esc(U.projectsEyebrow)}</h4>
        <div class="card m-list">${B.projects.map((p) => `<div class="m-li m-li2"><b>${esc(p.title)}</b><span class="m-sub">${esc(p.note)}</span></div>`).join("")}</div>
      </section>
      <section class="m-sec"><h4 class="eyebrow">${esc(U.aboutEyebrow)}</h4>
        <div class="m-split">
          <div class="m-sec"><b class="m-minor">${esc(U.memories)}</b><div class="card m-list">${B.memories.map((m) => `<div class="m-li m-li2"><span>${esc(m.text)}</span><span class="m-sub">${esc(m.src)}</span></div>`).join("")}</div></div>
          <div class="m-sec"><div class="m-sec-head"><b class="m-minor">${esc(U.experience)}</b><button type="button" class="linkbtn" data-resume>${esc(U.exportResume)}</button></div><div class="card m-list">${B.career.map((c) => `<div class="m-li m-li2"><span>${esc(c.title)}</span><span class="m-sub">${esc(c.period)} · ${esc(c.place)}</span></div>`).join("")}</div><p class="m-sub" data-resume-note aria-live="polite"></p></div>
        </div>
      </section>
    </div>`;

  /* ---------- 问问 ---------- */
  const A = L.ask;
  const msg = (m) => {
    if (m.role === "steps") return `<details class="m-steps"><summary>${esc(U.steps)}</summary><ul>${m.items.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul></details>`;
    const body = m.text.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("");
    return m.role === "user" ? `<div class="m-msg is-user">${body}</div>` : `<div class="m-msg is-ai">${body}</div>`;
  };
  const ask = () => `
    <div class="m-ask">
      <aside class="m-threads"><p class="m-newchat">${esc(U.newChat)}</p>${A.threads.map((t, i) => `<p class="m-thread${i === 0 ? " is-on" : ""}">${esc(t)}</p>`).join("")}</aside>
      <div class="m-chat">
        <div class="m-msgs">${A.messages.map(msg).join("")}</div>
        <div class="m-composer">
          <input disabled placeholder="${esc(U.composerPh)}" aria-label="${esc(U.composerPh)}">
          <div class="m-comp-row">
            <span class="m-act">＋</span><span class="m-act">${esc(U.quote)}</span><span class="m-act">${esc(U.scope)} ▾</span>
            <span class="m-modelwrap" data-hl="model">
              <button type="button" class="m-act" aria-expanded="false" aria-haspopup="true" data-model-btn><span data-model-name>${esc(A.models[A.current].name)}</span> ▾</button>
              <div class="m-pop" role="group" aria-label="${esc(U.currentAi)}" hidden data-model-pop>
                ${A.models.map((m, i) => `<button type="button" aria-pressed="${i === A.current}" data-model="${i}">${esc(m.name)} · ${esc(m.model)}</button>`).join("")}
                <span class="m-pop-add">${esc(U.addProvider)}</span>
              </div>
            </span>
            <span class="m-send" aria-hidden="true">↑</span>
          </div>
        </div>
        <p class="m-hint">${esc(U.enterHint)}</p>
      </div>
    </div>`;

  /* ---------- shell ---------- */
  const tabs = ["today", "explore", "library", "ask"];
  const panel = { today, explore, library, ask };
  root.innerHTML = `
    <div class="m-chrome"><span class="m-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="m-badge">${esc(U.badge)}</span></div>
    <div class="m-app">
      <div class="m-top">
        <div class="m-brand">${mark}<span>${esc(U.appName)}</span></div>
        <div class="m-tabs" role="tablist" aria-label="${esc(U.nav)}">
          ${tabs.map((id, i) => `<button type="button" role="tab" id="mt-${lang}-${id}" aria-controls="mp-${lang}-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(U.tabs[id])}</button>`).join("")}
        </div>
        <div class="m-tools"><span class="m-sync"><i class="m-dot7"></i><span data-sync>${esc(U.synced(saved))}</span></span><span class="m-avatar" aria-hidden="true">${esc(U.me)}</span></div>
      </div>
      <div class="m-body">
        ${tabs.map((id, i) => `<section class="m-panel${i === 0 ? " is-on" : ""}" role="tabpanel" id="mp-${lang}-${id}" aria-labelledby="mt-${lang}-${id}" tabindex="0">${panel[id]()}</section>`).join("")}
      </div>
    </div>`;
  root.classList.add("is-live");

  const tabEls = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  const select = (i, focus) => {
    tabEls.forEach((t, j) => {
      const on = i === j;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[j].classList.toggle("is-on", on);
      panels[j].inert = !on;
    });
    if (focus) tabEls[i].focus();
  };
  tabEls.forEach((t, i) => {
    t.addEventListener("click", () => { select(i); clearWalk(); });
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabEls.length - 1 - i }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      select((i + k + tabEls.length) % tabEls.length, true);
    });
  });
  select(0);

  const pressGroup = (attr, panelAttr) => {
    const btns = [...root.querySelectorAll(`[${attr}]`)];
    const show = (id) => {
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === id)));
      root.querySelectorAll(`[${panelAttr}]`).forEach((p) => { p.hidden = p.getAttribute(panelAttr) !== id; });
    };
    btns.forEach((b) => b.addEventListener("click", () => show(b.getAttribute(attr))));
    return show;
  };
  const showSub = pressGroup("data-sub", "data-subpanel");
  const showHealth = pressGroup("data-htab", "data-hpanel");

  // 随手记
  const form = root.querySelector("[data-capture]");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  input.addEventListener("input", () => { submit.disabled = !input.value.trim(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(text)}</span><span class="m-sub">${esc(U.captured)}</span>`;
    root.querySelector("[data-saved]").prepend(li);
    input.value = "";
    submit.disabled = true;
    saved += 1;
    root.querySelector("[data-sync]").textContent = U.synced(saved);
  });
  // 勾选下一步
  root.querySelectorAll("[data-check]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.closest("[data-row]").classList.toggle("is-done", on);
  }));
  const focusDone = root.querySelector("[data-focus-done]");
  focusDone.addEventListener("click", () => {
    const on = focusDone.getAttribute("aria-pressed") !== "true";
    focusDone.setAttribute("aria-pressed", String(on));
    focusDone.textContent = on ? `✓ ${U.doneState}` : U.done;
    root.querySelector("[data-focus]").classList.toggle("is-done", on);
  });
  // 待确认日程
  const pend = root.querySelector("[data-pending-acts]");
  if (pend) {
    const finish = (label, ok) => {
      const row = pend.closest("[data-pending]");
      row.querySelector(".m-sub").textContent = ok ? "" : ` · ${label}`;
      row.classList.toggle("is-dismissed", !ok);
      pend.outerHTML = `<span class="m-sub m-state">${esc(label)}</span>`;
    };
    pend.querySelector("[data-confirm]").addEventListener("click", () => finish(U.confirmed, true));
    pend.querySelector("[data-dismiss]").addEventListener("click", () => finish(U.dismissed, false));
  }
  // 资讯反馈：一条只能选一个
  root.querySelectorAll(".m-fb").forEach((g) => {
    const bs = [...g.querySelectorAll("[data-fb]")];
    bs.forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      bs.forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
    }));
  });
  // 方向详情
  const detailBtn = root.querySelector("[data-detail]");
  const toggleDetail = (open) => {
    const box = document.getElementById(detailBtn.getAttribute("aria-controls"));
    const on = open ?? detailBtn.getAttribute("aria-expanded") !== "true";
    detailBtn.setAttribute("aria-expanded", String(on));
    detailBtn.textContent = on ? U.hideDetails : U.details;
    box.hidden = !on;
  };
  detailBtn?.addEventListener("click", () => toggleDetail());
  // 导出简历（示例不下载）
  root.querySelector("[data-resume]").addEventListener("click", () => { root.querySelector("[data-resume-note]").textContent = U.exported; });
  // 模型菜单（0.1.0-rc.3：添加过的服务商都保留，菜单里切换）
  const mBtn = root.querySelector("[data-model-btn]");
  const pop = root.querySelector("[data-model-pop]");
  const setPop = (open) => { pop.hidden = !open; mBtn.setAttribute("aria-expanded", String(open)); };
  mBtn.addEventListener("click", () => setPop(pop.hidden));
  pop.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", () => {
    pop.querySelectorAll("[data-model]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    root.querySelector("[data-model-name]").textContent = A.models[Number(b.dataset.model)].name;
    setPop(false);
    mBtn.focus();
  }));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { setPop(false); mBtn.focus(); } });

  /* ---------- 引导时间线 ---------- */
  const walk = document.querySelector("[data-walk]");
  const cap = document.querySelector("[data-walk-cap]");
  let walkBtns = [];
  function clearWalk() {
    walkBtns.forEach((b) => b.setAttribute("aria-pressed", "false"));
    root.querySelectorAll(".is-hl").forEach((el) => el.classList.remove("is-hl"));
  }
  if (walk && cap) {
    walk.innerHTML = L.walk.map((s, i) => `<li><button type="button" aria-pressed="false" data-step="${i}"><span class="walk-day">${esc(s.day)}</span><span class="walk-title">${esc(s.title)}</span></button></li>`).join("");
    walkBtns = [...walk.querySelectorAll("button")];
    const persona = document.querySelector("[data-persona]");
    if (persona) persona.textContent = L.persona.line;
    walkBtns.forEach((b) => b.addEventListener("click", () => {
      const s = L.walk[Number(b.dataset.step)];
      select(tabs.indexOf(s.tab));
      if (s.sub) showSub(s.sub);
      if (s.hl === "note") showHealth("training");
      if (s.hl === "direction") toggleDetail(true);
      if (s.hl !== "model") setPop(false);
      clearWalk();
      b.setAttribute("aria-pressed", "true");
      cap.textContent = s.caption;
      const target = root.querySelector(`[data-hl="${s.hl}"]`);
      if (!target) return;
      target.classList.add("is-hl");
      const p = target.closest(".m-panel");
      const top = target.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - 24;
      p.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
      if (s.hl === "model") setPop(true);
    }));
  }
})();
