/* Kaitu site: reveal, AI swap, language switch, docs TOC + copy, download enhancer. Everything works without this file. */
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canObserve = "IntersectionObserver" in window;
  const en = document.documentElement.lang === "en";

  /* language switch: remember the choice, keep the hash */
  for (const a of document.querySelectorAll("[data-lang-switch]")) {
    a.addEventListener("click", () => {
      try { localStorage.setItem("kaitu-lang", a.dataset.langSwitch); } catch {}
      if (location.hash) a.href = a.getAttribute("href").split("#")[0] + location.hash;
    });
  }

  /* scroll reveal: one observer */
  const items = document.querySelectorAll("[data-reveal]");
  for (const group of document.querySelectorAll("[data-reveal-group]")) {
    group.querySelectorAll("[data-reveal]").forEach((el, i) => el.style.setProperty("--i", i));
  }
  if (still || !canObserve) items.forEach((el) => el.classList.add("is-in"));
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  }

  /* AI swap: the chip changes name, the card grows a row; plays once */
  const swap = document.querySelector("[data-swap]");
  if (swap && !still && canObserve) {
    const names = [...swap.querySelectorAll(".swap-name")];
    const rows = [...swap.querySelectorAll(".swap-row")];
    swap.classList.add("is-armed");
    names[0].classList.add("is-on");
    let i = 0;
    const step = () => {
      names[i].classList.replace("is-on", "is-off");
      i += 1;
      names[i].classList.add("is-on");
      rows[i]?.classList.add("is-on");
      if (i < names.length - 1) setTimeout(step, 1400);
    };
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      rows[0].classList.add("is-on");
      setTimeout(step, 1400);
    }, { threshold: 0.4 });
    io.observe(swap);
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

  /* docs TOC: scrollspy; on phones the TOC is a <details> that closes after a pick */
  const toc = document.querySelector("[data-toc]");
  if (toc) {
    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const targets = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    const narrow = matchMedia("(max-width: 760px)");
    toc.open = !narrow.matches;
    narrow.addEventListener("change", () => { if (!narrow.matches) toc.open = true; });
    links.forEach((a) => a.addEventListener("click", () => { if (narrow.matches) toc.open = false; }));
    let current = null;
    const mark = () => {
      const y = 120;
      let found = targets[0];
      for (const t of targets) if (t.getBoundingClientRect().top - y <= 0) found = t;
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

  /* every page: newest non-draft release with a .dmg fills [data-rel] spots, cached 10 minutes; any failure keeps the static text */
  const rel = document;
  if (document.querySelector("[data-rel]") && "fetch" in window) {
    const KEY = "kaitu-release-v1";
    const fill = (r) => {
      const dmg = r.assets.find((a) => /\.dmg$/i.test(a.name));
      if (!dmg) return;
      const tgz = r.assets.find((a) => /\.tgz$/i.test(a.name));
      const set = (name, fn) => rel.querySelectorAll(`[data-rel="${name}"]`).forEach(fn);
      const version = r.tag.replace(/^v/, "");
      const date = new Date(r.published);
      const mb = Math.round(dmg.size / 1048576);
      set("version", (el) => { el.textContent = version; });
      if (!Number.isNaN(date.getTime()))
        set("date", (el) => { el.textContent = new Intl.DateTimeFormat(en ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date); el.dateTime = r.published.slice(0, 10); });
      set("size", (el) => { el.textContent = `${mb} MB`; });
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
