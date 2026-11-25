/* Kaitu site: language switch, motion, tabs, copy buttons, docs TOC, latest release, OS-aware download link. Every page works without this file. */
(() => {
  const en = document.documentElement.lang === "en";

  /* sticky header gets a hairline once the page moves */
  const top = document.querySelector(".site-top");
  if (top) {
    const stuck = () => top.classList.toggle("is-stuck", scrollY > 8);
    addEventListener("scroll", stuck, { passive: true });
    stuck();
  }

  /* motion: decorative lines, dots and marks draw in when seen; text is readable before, during and after */
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window;
  const seen = new Map();
  const io = motion && new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      seen.get(e.target)?.();
    }
  }, { rootMargin: "0px 0px -18% 0px" });
  const onSeen = (el, fn) => { if (!io) return; seen.set(el, fn); io.observe(el); };
  if (motion) {
    document.documentElement.classList.add("motion");
    for (const el of document.querySelectorAll("[data-anim]")) onSeen(el, () => el.classList.add("is-in"));
    addEventListener("beforeprint", () => document.querySelectorAll("[data-anim]").forEach((el) => el.classList.add("is-in")));
  }

  /* swap: the AI changes, the list keeps going; it rests on the finished list */
  const swap = document.querySelector("[data-swap]");
  if (swap && motion) {
    const rows = [...swap.querySelectorAll("li[data-ai]")];
    const chip = swap.querySelector(".swap-chip");
    const label = chip?.firstElementChild;
    const step = (i) => {
      rows.forEach((row, j) => {
        row.classList.toggle("done", j <= i);
        row.classList.toggle("now", j === i);
        row.classList.toggle("lit", j === i);
      });
      if (label) { label.textContent = rows[i].dataset.ai; chip.classList.remove("flip"); void chip.offsetWidth; chip.classList.add("flip"); }
      if (i + 1 < rows.length) setTimeout(() => step(i + 1), 1150);
    };
    onSeen(swap, () => setTimeout(() => step(0), 250));
  }

  /* language switch: remember the choice, keep the hash */
  for (const a of document.querySelectorAll("[data-lang-switch]")) {
    a.addEventListener("click", () => {
      try { localStorage.setItem("kaitu-lang", a.dataset.langSwitch); } catch {}
      if (location.hash) a.href = a.getAttribute("href").split("#")[0] + location.hash;
    });
  }

  /* tabs: without JS every panel shows in turn; with JS one shows at a time */
  for (const box of document.querySelectorAll("[data-tabs]")) {
    const panels = [...box.querySelectorAll(":scope > .panel")];
    if (panels.length < 2) continue;
    const bar = document.createElement("div");
    bar.className = "tabs-bar";
    const list = document.createElement("div");
    list.className = "tablist";
    list.setAttribute("role", "tablist");
    if (box.dataset.tabsLabel) list.setAttribute("aria-label", box.dataset.tabsLabel);
    const caption = document.createElement("p");
    caption.className = "tab-caption";
    caption.setAttribute("aria-live", "polite");
    const pill = document.createElement("span");
    pill.className = "tab-pill";
    pill.setAttribute("aria-hidden", "true");
    list.append(pill);
    const tabs = panels.map((panel, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = `${panel.id}-tab`;
      tab.textContent = panel.querySelector("h3")?.textContent ?? String(i + 1);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panel.id);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.removeAttribute("aria-label");
      list.append(tab);
      return tab;
    });
    let current = 0;
    const place = () => {
      const tab = tabs[current];
      pill.style.width = `${tab.offsetWidth}px`;
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    };
    const select = (i, focus) => {
      current = i;
      tabs.forEach((tab, j) => {
        const on = i === j;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        panels[j].toggleAttribute("data-on", on);
      });
      caption.textContent = panels[i].querySelector("p")?.textContent ?? "";
      place();
      if (focus) tabs[i].focus();
    };
    tabs.forEach((tab, i) => tab.addEventListener("click", () => {
      select(i);
      try { history.replaceState(null, "", `#${panels[i].id}`); } catch {}
    }));
    if ("ResizeObserver" in window) new ResizeObserver(place).observe(list);
    list.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select((next + tabs.length) % tabs.length, true);
    });
    bar.append(list, caption);
    box.prepend(bar);
    box.classList.add("tabs-on");
    const fromHash = panels.findIndex((p) => `#${p.id}` === location.hash);
    select(fromHash < 0 ? 0 : fromHash);
  }

  /* copy buttons */
  for (const block of document.querySelectorAll(".codeblock")) {
    const btn = block.querySelector(".copy");
    const code = block.querySelector("code");
    if (!btn || !code) continue;
    const label = btn.textContent;
    btn.addEventListener("click", async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(code.textContent); ok = true; } catch {
        const r = document.createRange(); r.selectNodeContents(code);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      btn.textContent = ok ? (en ? "Copied" : "已复制") : (en ? "Selected" : "已选中");
      setTimeout(() => { btn.textContent = label; }, 1600);
    });
  }

  /* docs TOC: scrollspy; on narrow screens the TOC is a <details> that closes after a pick */
  const toc = document.querySelector("[data-toc]");
  if (toc) {
    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const targets = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    const narrow = matchMedia("(max-width: 960px)");
    toc.open = !narrow.matches;
    narrow.addEventListener("change", () => { if (!narrow.matches) toc.open = true; });
    links.forEach((a) => a.addEventListener("click", () => { if (narrow.matches) toc.open = false; }));
    let current = null;
    const mark = () => {
      let found = targets[0];
      for (const t of targets) if (t.getBoundingClientRect().top - 120 <= 0) found = t;
      if (found === current) return;
      current = found;
      for (const a of links) {
        if (a.hash.slice(1) === found?.id) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    };
    let raf = 0;
    addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
    mark();
  }

  /* newest non-draft release with a .dmg fills [data-rel] spots, cached 10 minutes; any failure keeps the static text */
  if (document.querySelector("[data-rel]") && "fetch" in window) {
    const KEY = "kaitu-release-v7";
    const fill = (r) => {
      const dmg = r.assets.find((a) => /\.dmg$/i.test(a.name));
      if (!dmg) return;
      const tgz = r.assets.find((a) => /^rensheng-kaitu-.*\.tgz$/i.test(a.name));
      const set = (name, fn) => document.querySelectorAll(`[data-rel="${name}"]`).forEach(fn);
      const version = r.tag.replace(/^v/, "");
      const date = new Date(r.published);
      set("version", (el) => { el.textContent = version; });
      if (!Number.isNaN(date.getTime()))
        set("date", (el) => { el.textContent = new Intl.DateTimeFormat(en ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date); el.dateTime = r.published.slice(0, 10); });
      set("size", (el) => { el.textContent = `${Math.round(dmg.size / 1048576)} MB`; });
      set("dmg", (el) => { el.href = dmg.url; });
      set("dmg-name", (el) => { el.textContent = dmg.name; });
      set("sha", (el) => { el.textContent = dmg.digest ? dmg.digest.replace(/^sha256:/, "") : "—"; });
      set("page", (el) => { el.href = r.page; });
      set("pre", (el) => { el.hidden = !r.prerelease; });
      set("stable", (el) => { el.hidden = r.prerelease; });
      if (tgz) {
        set("tgz", (el) => { el.href = tgz.url; });
        set("tgz-name", (el) => { el.textContent = tgz.name; });
        set("tgz-sha", (el) => { el.textContent = tgz.digest ? tgz.digest.replace(/^sha256:/, "") : "—"; });
        set("tgz-url", (el) => { el.textContent = tgz.url; });
      }
      document.documentElement.dataset.release = version;
    };
    let cached = null;
    try {
      const c = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (c && Date.now() - c.t < 600000) cached = c.r;
    } catch {}
    if (cached) fill(cached);
    else {
      const ctrl = "AbortController" in window ? new AbortController() : null;
      const timer = ctrl && setTimeout(() => ctrl.abort(), 8000);
      fetch("https://api.github.com/repos/Stahl-G/rensheng-kaitu/releases?per_page=10", { headers: { Accept: "application/vnd.github+json" }, signal: ctrl?.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((list) => {
          const pick = Array.isArray(list) && list.find((x) => !x.draft && x.assets?.some((a) => /\.dmg$/i.test(a.name)));
          if (!pick) return;
          const r = {
            tag: pick.tag_name, published: pick.published_at || pick.created_at, prerelease: !!pick.prerelease, page: pick.html_url,
            assets: pick.assets.map((a) => ({ name: a.name, size: a.size, digest: a.digest || "", url: a.browser_download_url })),
          };
          fill(r);
          try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), r })); } catch {}
        })
        .catch(() => {})
        .finally(() => timer && clearTimeout(timer));
    }
  }
})();

/* Windows and Linux visitors go to the DSH plugin guide; Macs keep the download. */
(() => {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const agent = navigator.userAgent || "";
  const os = /win/i.test(platform) || /Windows/.test(agent)
    ? "Windows"
    : (/linux|x11|cros/i.test(platform) || /Linux|X11|CrOS/.test(agent)) && !/Android/.test(agent)
      ? "Linux"
      : "";
  if (!os) return;
  const en = location.pathname.startsWith("/en/");
  for (const el of document.querySelectorAll("[data-dl]")) {
    el.href = `${en ? "/en" : ""}/download/#${os === "Windows" ? "windows" : "plugin"}`;
    el.textContent = os === "Windows" ? (en ? "Install on Windows" : "Windows 插件安装指引") : (en ? "Install on Linux" : "Linux 版安装指引");
  }
  for (const el of document.querySelectorAll("[data-dl-meta]"))
    el.textContent = os === "Windows" ? (en ? "Windows · DeepSeek Harness plugin" : "Windows · DeepSeek Harness 插件") : (en ? "Linux · DeepSeek Harness plugin" : "Linux · DeepSeek Harness 插件");
  if (/\/download\/?$/.test(location.pathname) && !location.hash) {
    const target = document.getElementById(os === "Windows" ? "windows" : "plugin");
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
