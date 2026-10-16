/* Notes on … — the canon grid on the home page. */
(function () {
  "use strict";
  const fig = document.querySelector("figure.canon");
  if (!fig) return;
  const tip = document.getElementById("canon-tip");
  const legend = document.getElementById("canon-legend");
  const tiles = [...fig.querySelectorAll(".tile")];
  const defaultTip = tip.innerHTML;

  // circle of fifths order, with the same colours as KEY_COLORS in build.py
  const FIFTHS = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
  const COLORS = ["#4E79A7", "#59A14F", "#E3B93B", "#F28E2B", "#E15759", "#B07AA1", "#FF9DA7", "#9C755F", "#A9A29E", "#5FADA6", "#8CD17D", "#93C3E6"];

  const LEGENDS = {
    key: () => FIFTHS.map((n, i) => `<span class="lg"><i style="background: ${COLORS[i]}"></i>${n}</span>`).join("") +
      `<span class="lg muted"><i class="lg-minor" style="background: var(--pencil); position: relative"></i>dot: minor key</span>`,
    mode: () => `<span class="lg"><i style="background: var(--staff)"></i>Major</span><span class="lg"><i style="background: var(--ink)"></i>Minor</span>`,
    written: () => `<span class="lg ramp-legend"><span>May 1989</span><i class="ramp"></i><span>2001</span></span><span class="lg muted">when Pollack first posted the note</span>`,
    writer: () => people("writer", [["lennon", "Lennon"], ["mccartney", "McCartney"], ["lennon-mccartney", "Lennon and McCartney together"], ["harrison", "Harrison"], ["starkey", "Starr"], ["all", "All four"], ["group", "Two or three of them"], ["other", "Cover"], ["", "Not in the Beatles DB"]]) +
      `<span class="lg muted">the main writer, not the official credit</span>`,
    vocal: () => people("vocal", [["lennon", "Lennon"], ["mccartney", "McCartney"], ["lennon-mccartney", "Lennon and McCartney"], ["harrison", "Harrison"], ["starkey", "Starr"], ["all", "All four"], ["group", "Shared lead"], ["none", "Instrumental"], ["", "Not in the Beatles DB"]]),
    read: () => {
      const n = tiles.filter((t) => t.classList.contains("is-read")).length;
      return `<span class="lg"><i style="background: var(--staff)"></i>Read (${n} of ${tiles.length})</span><span class="lg"><i style="background: var(--paper-3)"></i>Not yet</span>`;
    },
  };

  // legend entries with counts, skipping groups no song falls into
  function people(attr, groups) {
    return groups.map(([g, label]) => {
      const n = tiles.filter((t) => t.dataset[attr] === g).length;
      if (!n) return "";
      const sw = g === "none" || !g ? `<i class="lg-hollow"></i>` : `<i style="background: var(--p-${g})"></i>`;
      return `<span class="lg">${sw}${label} (${n})</span>`;
    }).join("");
  }

  function markRead() {
    if (!window.PN) return;
    tiles.forEach((t) => t.classList.toggle("is-read", !!PN.isRead(PN.slugFromHref(t.getAttribute("href")))));
  }

  // position of each note's first posting between May 1989 and the end of 2001, as 0..1
  const T0 = Date.UTC(1989, 4, 1), T1 = Date.UTC(2001, 11, 31);
  tiles.forEach((t) => {
    const d = Date.parse(t.dataset.written || "");
    if (!isNaN(d)) t.style.setProperty("--w", Math.max(0, Math.min(1, (d - T0) / (T1 - T0))).toFixed(3));
  });

  function setMode(mode) {
    fig.dataset.color = mode;
    fig.querySelectorAll("[data-color]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.color === mode)); });
    legend.innerHTML = LEGENDS[mode]();
    if (window.PN) PN.store.set("pn-canon-color", mode);
  }
  fig.querySelectorAll("button[data-color]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.color)));

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function show(t) {
    const [title, key, rel, written, writer, vocal] = (t.dataset.tip || "").split("|");
    const read = t.classList.contains("is-read") ? ", read" : "";
    const mode = fig.dataset.color;
    const who = mode === "writer" && writer ? `. Written by ${esc(writer)}` : mode === "vocal" && vocal ? `. Sung by ${esc(vocal)}` : "";
    tip.innerHTML = `<strong>${esc(title)}</strong>${key ? ", " + esc(key) : ""}. ${esc(rel)}${who}${written ? ". Note first posted " + esc(written) : ""}${read}.`;
  }
  fig.addEventListener("mouseover", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("focusin", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("mouseleave", () => { tip.innerHTML = defaultTip; });

  markRead();
  setMode((window.PN && PN.store.get("pn-canon-color", "key")) || "key");
  document.addEventListener("pn:read", markRead);
})();
