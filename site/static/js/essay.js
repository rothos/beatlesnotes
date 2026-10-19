/* Notes on … — essay pages: outline, read state, form strip, glossary terms, search highlights. */
(function () {
  "use strict";
  const art = document.querySelector("article.essay");
  if (!art) return;
  const prose = art.querySelector(".prose");
  const slug = art.dataset.slug;

  // ---------------------------------------------------------------- outline: scrollspy + drawer
  const toc = document.getElementById("toc");
  const rail = art.querySelector(".rail");
  if (toc && prose) {
    const links = new Map();
    toc.querySelectorAll("a[href^='#']").forEach((a) => links.set(decodeURIComponent(a.getAttribute("href").slice(1)), a));
    const heads = [...prose.querySelectorAll("h2[id], h3[id]")].filter((h) => links.has(h.id));
    let active = null;
    const setActive = (id) => {
      if (active === id) return;
      active = id;
      links.forEach((a, k) => a.classList.toggle("active", k === id));
      const a = links.get(id);
      if (a && toc.scrollHeight > toc.clientHeight) {
        const r = a.getBoundingClientRect(), tr = toc.getBoundingClientRect();
        if (r.top < tr.top || r.bottom > tr.bottom) a.scrollIntoView({ block: "nearest" });
      }
    };
    const onScroll = () => {
      let cur = null;
      for (const h of heads) { if (h.getBoundingClientRect().top < 120) cur = h.id; else break; }
      if (cur) setActive(cur);
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  if (rail && toc) {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "toc-fab";
    fab.setAttribute("aria-expanded", "false");
    fab.textContent = "Outline";
    document.body.appendChild(fab);
    const setOpen = (on) => { rail.classList.toggle("open", on); fab.setAttribute("aria-expanded", String(on)); };
    fab.addEventListener("click", () => setOpen(!rail.classList.contains("open")));
    rail.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  // ---------------------------------------------------------------- read state
  const readBtn = art.querySelector("[data-read-toggle]");
  if (readBtn && window.PN) {
    const sync = () => {
      const on = PN.isRead(slug);
      readBtn.setAttribute("aria-pressed", String(on));
      readBtn.textContent = on ? "Read" : "Mark as read";
    };
    readBtn.addEventListener("click", () => { PN.setRead(slug, !PN.isRead(slug)); sync(); });
    sync();
    // reaching the end of a note after a while counts as reading it
    const opened = Date.now();
    const MIN_MS = 20000;
    const end = art.querySelector(".signoff") || art.querySelector(".essay-foot");
    if (end && "IntersectionObserver" in window) {
      let visible = false, timer = null;
      const mark = () => { if (visible && !PN.isRead(slug)) { PN.setRead(slug, true); sync(); io.disconnect(); } };
      const io = new IntersectionObserver((entries) => {
        visible = entries.some((en) => en.isIntersecting);
        clearTimeout(timer);
        // if the end is on screen before 20 s have passed, check again once they have
        if (visible) timer = setTimeout(mark, Math.max(0, MIN_MS - (Date.now() - opened)));
      });
      io.observe(end);
    }
  }

  // ---------------------------------------------------------------- form strip -> walkthrough headings
  const norm = (s) => s.toLowerCase().replace(/[’'"]/g, "").replace(/\(.*?\)/g, "").replace(/\s+\d+$|\s*#\d+/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  art.querySelectorAll("[data-form]").forEach((form) => {
    const part = form.closest(".part") || prose;
    const heads = [...part.querySelectorAll("h3[id]")];
    // only look inside the walkthrough, where the section headings live
    form.querySelectorAll(".sec").forEach((li) => {
      const label = norm(li.dataset.section || "");
      if (!label) return;
      const h = heads.find((x) => norm(x.textContent) === label) ||
        heads.find((x) => norm(x.textContent).startsWith(label)) ||
        heads.find((x) => label.startsWith(norm(x.textContent)) && norm(x.textContent).length > 3);
      if (!h) return;
      li.dataset.target = h.id;
      li.tabIndex = 0;
      li.setAttribute("role", "link");
      li.setAttribute("aria-label", `${li.dataset.section}: jump to the walkthrough`);
      const go = () => { h.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); history.replaceState(null, "", "#" + h.id); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  });

  // ---------------------------------------------------------------- glossary terms
  const G = window.PN_GLOSSARY || [];
  if (prose && G.length) {
    const byText = new Map();
    const words = [];
    G.filter((g) => g.inline !== false).forEach((g) => [g.term, ...(g.aka || []), ...(g.match || [])].forEach((w) => { byText.set(w.toLowerCase(), g); words.push(w); }));
    words.sort((a, b) => b.length - a.length);
    const re = new RegExp("\\b(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[- ]")).join("|") + ")\\b", "i");
    const used = new Set();
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest("a, h2, h3, figure, pre, code, .gl-term, .signoff")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let text = node.nodeValue, m, cur = node;
      let guard = 0;
      while ((m = re.exec(cur.nodeValue)) && guard++ < 6) {
        const k = m[1].toLowerCase();
        const g = byText.get(k) || byText.get(k.replace(/ /g, "-")) || byText.get(k.replace(/-/g, " "));
        if (!g || used.has(g.id)) {
          // skip past this match
          const rest = cur.splitText(m.index + m[0].length);
          cur = rest;
          continue;
        }
        used.add(g.id);
        const before = cur;
        const mid = before.splitText(m.index);
        const after = mid.splitText(m[0].length);
        const span = document.createElement("span");
        span.className = "gl-term";
        span.tabIndex = 0;
        span.dataset.gl = g.id;
        span.textContent = mid.nodeValue;
        mid.replaceWith(span);
        cur = after;
      }
      void text;
    }
    let pop = null, shownAt = 0;
    const hide = () => { if (pop) { pop.remove(); pop = null; } };
    const show = (el) => {
      hide();
      const g = G.find((x) => x.id === el.dataset.gl);
      if (!g) return;
      pop = document.createElement("div");
      pop.className = "gl-pop";
      pop.setAttribute("role", "tooltip");
      const root = document.body.dataset.root || "";
      pop.innerHTML = `<strong></strong><span></span> <a href="${root}glossary.html#${g.id}">Glossary</a>`;
      pop.querySelector("strong").textContent = g.term;
      pop.querySelector("span").textContent = g.def;
      document.body.appendChild(pop);
      const r = el.getBoundingClientRect();
      const w = pop.offsetWidth;
      const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8));
      pop.style.left = left + "px";
      pop.style.top = window.scrollY + r.bottom + 8 + "px";
      pop.addEventListener("mouseleave", hide);
      shownAt = window.scrollY;
    };
    prose.addEventListener("mouseover", (e) => { const t = e.target.closest(".gl-term"); if (t) show(t); });
    prose.addEventListener("mouseout", (e) => {
      const t = e.target.closest(".gl-term");
      if (t && pop && !pop.contains(e.relatedTarget)) setTimeout(() => { if (pop && !pop.matches(":hover")) hide(); }, 120);
    });
    prose.addEventListener("focusin", (e) => { const t = e.target.closest(".gl-term"); if (t) show(t); });
    prose.addEventListener("focusout", () => setTimeout(() => { if (pop && !pop.contains(document.activeElement)) hide(); }, 100));
    prose.addEventListener("click", (e) => { const t = e.target.closest(".gl-term"); if (t) { pop ? hide() : show(t); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    window.addEventListener("scroll", () => { if (pop && Math.abs(window.scrollY - shownAt) > 60) hide(); }, { passive: true });
  }

  // ---------------------------------------------------------------- highlight search terms (?hl=…)
  const hl = new URLSearchParams(location.search).get("hl");
  if (hl && prose) {
    const q = PN.norm(hl.trim());
    const terms = (/^".*"$/.test(q) ? [q.slice(1, -1)] : q.split(/\s+/)).filter((t) => t.length > 1);
    if (terms.length) {
      const src = "(" + terms.map((t) => PN.termPattern(t, false)).join("|") + ")";
      const re = new RegExp(src, "gi"), has = new RegExp(src, "i");  // `has` has no lastIndex to carry over
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walker.nextNode()) if (has.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
      hits.forEach((n) => {
        if (n.parentElement.closest("pre")) return;
        const frag = document.createDocumentFragment();
        n.nodeValue.split(re).forEach((part, i) => {
          if (i % 2) { const m = document.createElement("mark"); m.textContent = part; frag.appendChild(m); }
          else frag.appendChild(document.createTextNode(part));
        });
        n.replaceWith(frag);
      });
    }
  }
})();
