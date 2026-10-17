/* Notes on … — shared behaviour: reading settings, search, keyboard, read-tracking. */
(function () {
  "use strict";
  const doc = document.documentElement;
  const root = document.body.dataset.root || "";

  // ---------------------------------------------------------------- storage helpers
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
    },
  };

  // ---------------------------------------------------------------- read tracking
  const readSet = new Set(store.get("pn-read", []));
  const PN = (window.PN = {
    root,
    store,
    isRead: (slug) => readSet.has(slug),
    setRead(slug, on) {
      on ? readSet.add(slug) : readSet.delete(slug);
      store.set("pn-read", [...readSet]);
      document.dispatchEvent(new CustomEvent("pn:read", { detail: { slug, on } }));
    },
    readCount: () => readSet.size,
    clearRead() {
      readSet.clear();
      store.set("pn-read", []);
      document.dispatchEvent(new CustomEvent("pn:read", { detail: { slug: null, on: false } }));
    },
    slugFromHref(href) {
      const m = /(?:^|\/)note-([\w.\-]+)\.html/.exec(href || "");
      return m ? m[1] : null;
    },
  });

  // ---------------------------------------------------------------- reading settings
  const DEFAULTS = { theme: "auto", font: "serif", size: "0", leading: "normal", measure: "normal", align: "left", charts: "drawn" };
  let settings = Object.assign({}, DEFAULTS, store.get("pn-settings", {}));

  function applySettings() {
    const saved = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (settings[k] !== DEFAULTS[k]) { doc.dataset[k] = settings[k]; saved[k] = settings[k]; }
      else delete doc.dataset[k];
    }
    store.set("pn-settings", saved);
    document.querySelectorAll("[data-setting]").forEach((group) => {
      const k = group.dataset.setting;
      group.querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === settings[k])));
      const out = group.querySelector("[data-out]");
      if (out) out.textContent = Math.round(100 * sizeFactor(+settings[k])) + "%";
    });
  }
  const SIZES = { "-2": 0.84, "-1": 0.92, "0": 1, "1": 1.08, "2": 1.18, "3": 1.3, "4": 1.42 };
  const sizeFactor = (n) => SIZES[String(n)] || 1;

  const panel = document.getElementById("settings");
  const toggle = document.querySelector("[data-settings-toggle]");
  if (panel && toggle) {
    const open = (on) => { panel.hidden = !on; toggle.setAttribute("aria-expanded", String(on)); };
    toggle.addEventListener("click", (e) => { e.stopPropagation(); open(panel.hidden); });
    document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target)) open(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); toggle.focus(); } });
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const group = b.closest("[data-setting]");
      if (b.matches("[data-settings-reset]")) settings = Object.assign({}, DEFAULTS);
      else if (group && b.dataset.value) settings[group.dataset.setting] = b.dataset.value;
      else if (group && b.dataset.step) {
        const n = Math.max(-2, Math.min(4, +settings.size + +b.dataset.step));
        settings.size = String(n);
      }
      applySettings();
    });
  }
  applySettings();

  // ---------------------------------------------------------------- search
  const dlg = document.getElementById("search");
  const q = document.getElementById("q");
  const list = document.getElementById("search-results");
  const hint = document.getElementById("search-hint");
  let index = null, loading = null, sel = -1;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = root + "assets/js/search-index.js";
      s.onload = () => {
        index = (window.PN_SEARCH || []).map((d) => ({ ...d, tl: norm(d.t), xl: norm(d.x) }));
        resolve(index);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return loading;
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  // A normalised term as a regex source that matches either quote style; `html` when matching escaped text.
  const termPattern = (t, html) => [...t].map((c) => c === "'" ? "['‘’]"
    : c === '"' ? (html ? '(?:&quot;|["“”])' : '["“”]') : reEsc(html ? esc(c) : c)).join("");
  PN.norm = norm;
  PN.termPattern = termPattern;

  function search(raw) {
    const query = norm(raw.trim());
    if (!query) return [];
    const phrase = /^".*"$/.test(query) ? [query.slice(1, -1)] : null;
    const terms = phrase || query.split(/\s+/).filter(Boolean);
    const out = [];
    for (const d of index) {
      let score = 0, ok = true;
      for (const t of terms) {
        const inTitle = d.tl.includes(t);
        const at = d.xl.indexOf(t);
        if (!inTitle && at < 0 && d.n !== t) { ok = false; break; }
        if (inTitle) score += d.tl === query ? 400 : d.tl.startsWith(t) ? 160 : 90;
        if (at >= 0) {
          let c = 0, i = at;
          while (i >= 0 && c < 25) { c++; i = d.xl.indexOf(t, i + t.length); }
          score += c * 2;
        }
      }
      if (ok) out.push({ d, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 40).map((r) => ({ ...r, terms }));
  }

  function snippet(d, terms) {
    let at = -1, term = "";
    for (const t of terms) { const i = d.xl.indexOf(t); if (i >= 0 && (at < 0 || i < at)) { at = i; term = t; } }
    if (at < 0) return esc(d.x.slice(0, 160)) + "…";
    const start = Math.max(0, d.x.lastIndexOf(" ", Math.max(0, at - 70)));
    const end = Math.min(d.x.length, at + 170);
    let s = esc(d.x.slice(start, end));
    const re = new RegExp("(" + terms.map((t) => termPattern(t, true)).join("|") + ")", "gi");
    s = s.replace(re, "<mark>$1</mark>");
    return (start > 0 ? "…" : "") + s + (end < d.x.length ? "…" : "");
  }

  function render(results, raw) {
    sel = -1;
    if (!raw.trim()) { list.innerHTML = ""; hint.hidden = false; return; }
    hint.hidden = true;
    if (!results.length) {
      list.innerHTML = `<li class="search-hint">No note mentions “${esc(raw)}”. Try fewer words, or a different spelling.</li>`;
      return;
    }
    list.innerHTML = results.map((r, i) => {
      const d = r.d;
      const meta = [d.n ? "No. " + d.n.split(".")[0] : "", d.k].filter(Boolean).join(", ");
      const title = esc(d.t).replace(new RegExp("(" + r.terms.map((t) => termPattern(t, true)).join("|") + ")", "gi"), "<mark>$1</mark>");
      const sn = d.tl.includes(r.terms[0]) && r.terms.length === 1 ? "" : `<span class="r-s">${snippet(d, r.terms)}</span>`;
      const q = encodeURIComponent(raw.trim());
      return `<li><a href="${root}${d.u}?hl=${q}" id="sr-${i}"><span class="r-t">${title}</span><span class="r-m">${esc(meta)}</span>${sn}</a></li>`;
    }).join("");
  }

  let timer;
  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => loadIndex().then(() => render(search(q.value), q.value)), 60);
  }

  function openSearch(prefill) {
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    if (prefill) q.value = prefill;
    q.focus(); q.select();
    loadIndex().then(() => { if (q.value) onInput(); });
  }
  window.PN.openSearch = openSearch;

  if (dlg) {
    document.querySelectorAll("[data-open-search]").forEach((b) => b.addEventListener("click", () => openSearch()));
    q.addEventListener("input", onInput);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    q.addEventListener("keydown", (e) => {
      const items = list.querySelectorAll("a");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((a, i) => a.setAttribute("aria-selected", String(i === sel)));
        items[sel].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const a = items[Math.max(sel, 0)];
        if (a) location.href = a.href;
      }
    });
  }

  // ---------------------------------------------------------------- a random note, preferring unread ones
  document.querySelectorAll("[data-random]").forEach((b) => b.addEventListener("click", () => {
    const urls = b.dataset.urls.split(" ").filter(Boolean);
    const unread = urls.filter((u) => !PN.isRead(PN.slugFromHref(u)));
    const pool = unread.length ? unread : urls;
    location.href = root + pool[Math.floor(Math.random() * pool.length)];
  }));

  // Fill the feedback mail with the page it came from, so reports say where they mean.
  document.querySelectorAll("[data-feedback]").forEach((a) => a.addEventListener("click", () => {
    const addr = a.href.replace(/^mailto:/, "").split("?")[0];
    const page = document.title.split(" — ")[0];
    const url = a.dataset.url || location.href;
    a.href = "mailto:" + addr + "?subject=" + encodeURIComponent("Correction: " + page) +
      "&body=" + encodeURIComponent("Page: " + url + "\n\n");
  }));

  // ---------------------------------------------------------------- keyboard
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (!typing && !e.metaKey && !e.ctrlKey && e.key === "/")) {
      e.preventDefault(); openSearch(); return;
    }
    if (typing || e.metaKey || e.ctrlKey || (dlg && dlg.open)) return;
    const art = document.querySelector("article.essay");
    if (e.key === "]" && art && art.dataset.next) location.href = art.dataset.next;
    else if (e.key === "[" && art && art.dataset.prev) location.href = art.dataset.prev;
    else if (e.key === "t") document.dispatchEvent(new CustomEvent("pn:toggle-outline"));
  });
})();
