/* Notes on … — the songs table: filter, sort, and a circle-of-fifths summary. */
(function () {
  "use strict";
  const S = window.PN_SONGS || [];
  const table = document.getElementById("songtable");
  const form = document.getElementById("filters");
  if (!table || !form || !S.length) return;
  const tbody = table.tBodies[0];
  const rows = [...tbody.rows];
  const count = document.getElementById("count");
  const NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

  // ---------------------------------------------------------------- populate selects
  const opt = (sel, values) => values.forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); });
  const keys = new Set(S.filter((s) => s.key_info).map((s) => s.key_info.pc));
  opt(form.key, FIFTHS.filter((pc) => keys.has(pc)).map((pc) => [String(pc), NAMES[pc]]));
  const meters = [...new Set(S.map((s) => s.meter_short).filter(Boolean))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  opt(form.meter, meters.map((m) => [m, m]));
  const rels = [];
  S.forEach((s) => { if (s.release_slug && !rels.some((r) => r[0] === s.release_slug)) rels.push([s.release_slug, `${s.release} (${s.year})`]); });
  opt(form.release, rels);

  // ---------------------------------------------------------------- read marks
  const slugOf = (href) => (window.PN ? PN.slugFromHref(href) : null);
  const markRead = () => rows.forEach((r) => r.classList.toggle("is-read", !!(window.PN && PN.isRead(slugOf(r.dataset.href)))));
  markRead();

  // ---------------------------------------------------------------- sort keys
  const dateKey = (d) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(d || ""); if (!m) return "9999"; const y = m[3].length === 2 ? "19" + m[3] : m[3]; return y + m[2].padStart(2, "0") + m[1].padStart(2, "0"); };
  const numKey = (v) => { const m = /^C?(\d+)([a-z]?)/i.exec(v || ""); return m ? (/^C/i.test(v) ? 1000 : 0) + parseInt(m[1], 10) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0) : 99999; };
  const SORTERS = {
    canon: (s) => (s.canon ? (s.canon.startsWith("C") ? 500 + numKey(s.canon.slice(1)) : s.canon.startsWith("T") ? 900 : parseInt(s.canon, 10)) : 9999),
    title: (s) => s.title.replace(/^(The|A) /, "").toLowerCase(),
    key: (s) => (s.key_info ? FIFTHS.indexOf(s.key_info.pc) * 2 + (s.key_info.mode === "minor" ? 1 : 0) : 99),
    meter: (s) => s.meter_short || "~",
    release: (s) => (s.year || 9999) * 100 + (s.release_slug ? rels.findIndex((r) => r[0] === s.release_slug) : 99),
    recorded: (s) => dateKey(s.recorded),
    series: (s) => numKey(s.series),
    written: (s) => s.written || "9999",
    writer: (s) => (s.kind !== "original" ? "~" : WHO.indexOf(s.writer_group) + 10),
    vocal: (s) => (s.vocal_group ? WHO.indexOf(s.vocal_group) + 10 : 99),
    duration: (s) => s.duration || 99999,
  };
  const WHO = ["lennon", "mccartney", "lennon-mccartney", "harrison", "starkey", "group", "other", "none"];
  let sortBy = "canon", dir = 1;

  function apply() {
    const f = Object.fromEntries(new FormData(form));
    const q = (f.q || "").trim().toLowerCase();
    let n = 0;
    const visible = [];
    rows.forEach((r) => {
      const s = S[+r.dataset.i];
      let ok = true;
      if (q && !s.title.toLowerCase().includes(q)) ok = false;
      if (f.key && (!s.key_info || String(s.key_info.pc) !== f.key)) ok = false;
      if (f.mode && (!s.key_info || s.key_info.mode !== f.mode)) ok = false;
      if (f.meter && s.meter_short !== f.meter) ok = false;
      if (f.release && s.release_slug !== f.release) ok = false;
      if (f.writer && (s.kind !== "original" || s.writer_group !== f.writer)) ok = false;
      if (f.vocal && s.vocal_group !== f.vocal) ok = false;
      if (f.hit && !s.billboard) ok = false;
      if (f.kind === "original" && s.kind !== "original") ok = false;
      if (f.kind === "cover" && s.kind !== "cover") ok = false;
      if (f.kind === "extra" && s.kind !== "extra") ok = false;
      if (f.unread && r.classList.contains("is-read")) ok = false;
      r.hidden = !ok;
      if (ok) { n++; visible.push(s); }
    });
    count.textContent = n === rows.length ? `${n} songs` : `${n} of ${rows.length} songs`;
    // remember filters in the address, so a filtered view can be shared
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (sortBy !== "canon" || dir !== 1) params.set("sort", (dir < 0 ? "-" : "") + sortBy);
    history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
    drawWheel(visible);
  }

  function sort() {
    const fn = SORTERS[sortBy];
    const sorted = rows.slice().sort((a, b) => {
      const x = fn(S[+a.dataset.i]), y = fn(S[+b.dataset.i]);
      return (x < y ? -1 : x > y ? 1 : +a.dataset.i - +b.dataset.i) * dir;
    });
    sorted.forEach((r) => tbody.appendChild(r));
    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.sort === sortBy ? (dir > 0 ? "ascending" : "descending") : "none");
    });
  }

  table.querySelectorAll("th[data-sort] button").forEach((b) => b.addEventListener("click", () => {
    const k = b.parentElement.dataset.sort;
    if (k === sortBy) dir = -dir; else { sortBy = k; dir = 1; }
    sort(); apply();
  }));
  form.addEventListener("input", apply);
  form.addEventListener("submit", (e) => e.preventDefault());

  // restore from URL
  const params = new URLSearchParams(location.search);
  params.forEach((v, k) => {
    if (k === "sort") { dir = v.startsWith("-") ? -1 : 1; sortBy = v.replace(/^-/, ""); if (!SORTERS[sortBy]) sortBy = "canon"; return; }
    const el = form.elements[k];
    if (!el) return;
    if (el.type === "checkbox") el.checked = true; else el.value = v;
  });

  // ---------------------------------------------------------------- circle of fifths
  const wheel = document.getElementById("keywheel");
  function drawWheel(list) {
    if (!wheel) return;
    const maj = new Array(12).fill(0), min = new Array(12).fill(0);
    let other = 0;
    list.forEach((s) => { if (!s.key_info) other++; else (s.key_info.mode === "minor" ? min : maj)[s.key_info.pc]++; });
    const max = Math.max(1, ...maj, ...min);
    const W = 360, c = W / 2, R1 = 140, R2 = 88;
    const dot = (n) => (n ? 7 + 21 * Math.sqrt(n / max) : 0);
    let svg = `<svg viewBox="0 0 ${W} ${W}" role="img" aria-label="Home keys of the songs shown, arranged around the circle of fifths">`;
    svg += `<circle cx="${c}" cy="${c}" r="${R1}" fill="none" stroke="var(--rule)"/><circle cx="${c}" cy="${c}" r="${R2}" fill="none" stroke="var(--rule)"/>`;
    FIFTHS.forEach((pc, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const COLORS = ["#4E79A7", "#59A14F", "#E3B93B", "#F28E2B", "#E15759", "#B07AA1", "#FF9DA7", "#9C755F", "#A9A29E", "#5FADA6", "#8CD17D", "#93C3E6"];
      [[R1, maj[pc], "major", NAMES[pc], "var(--tile-l-major)"], [R2, min[(pc + 9) % 12], "minor", NAMES[(pc + 9) % 12].toLowerCase(), "var(--tile-l-minor)"]].forEach(([r, n, mode, label, l]) => {
        const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
        const rr = dot(n);
        const base = COLORS[mode === "minor" ? FIFTHS.indexOf((pc + 9) % 12) : i];
        const fill = base;  // minor keys keep their colour; the inner ring says they are minor
        svg += `<g><title>${label} ${mode}: ${n} song${n === 1 ? "" : "s"}</title>`;
        if (rr) svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${fill}"/>`;
        else svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--rule)"/>`;
        svg += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="${mode === "major" ? 12.5 : 11}" font-weight="${n ? 600 : 400}" ${rr > 14 ? 'fill="#10131c"' : ""}>${n ? label : ""}</text></g>`;
      });
    });
    svg += `<text x="${c}" y="${c - 4}" text-anchor="middle" font-size="12" fill="var(--pencil)">major outside</text><text x="${c}" y="${c + 12}" text-anchor="middle" font-size="12" fill="var(--pencil)">minor inside</text></svg>`;
    const top = maj.map((n, pc) => [n, NAMES[pc] + " major"]).concat(min.map((n, pc) => [n, NAMES[pc] + " minor"])).sort((a, b) => b[0] - a[0]).filter((x) => x[0]).slice(0, 5);
    const minorShare = list.length ? Math.round((100 * min.reduce((a, b) => a + b, 0)) / Math.max(1, list.length - other)) : 0;
    wheel.innerHTML = svg + `<div class="kw-cap"><p>Of these ${list.length} songs, the commonest home keys are ${top.map((t) => `${t[1]} (${t[0]})`).join(", ") || "none"}.</p>` +
      `<p>${minorShare}% are in minor keys.</p>` +
      (other ? `<p class="muted">${other} with no single home key (marked “various”, or not given) are left out.</p>` : "") + `</div>`;
  }

  sort();
  apply();
  document.addEventListener("pn:read", () => { markRead(); apply(); });
})();
