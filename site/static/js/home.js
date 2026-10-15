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
      `<span class="lg muted">darker shade: minor key</span>`,
    mode: () => `<span class="lg"><i style="background: var(--staff)"></i>Major</span><span class="lg"><i style="background: var(--ink)"></i>Minor</span>`,
    written: () => `<span class="lg"><i style="background: oklch(0.88 0.09 250)"></i>1989</span><span class="lg"><i style="background: oklch(0.63 0.09 250)"></i>1994</span><span class="lg"><i style="background: oklch(0.28 0.09 250)"></i>2001</span>`,
    read: () => {
      const n = tiles.filter((t) => t.classList.contains("is-read")).length;
      return `<span class="lg"><i style="background: var(--staff)"></i>Read (${n} of ${tiles.length})</span><span class="lg"><i style="background: var(--paper-3)"></i>Not yet</span>`;
    },
  };

  function markRead() {
    if (!window.PN) return;
    tiles.forEach((t) => t.classList.toggle("is-read", !!PN.isRead(PN.slugFromHref(t.getAttribute("href")))));
  }

  tiles.forEach((t) => {
    const y = parseInt(t.dataset.written, 10);
    if (y) t.style.setProperty("--w", Math.min(12, y - 1989));
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
    const [title, key, rel] = (t.dataset.tip || "").split("|");
    const read = t.classList.contains("is-read") ? ", read" : "";
    tip.innerHTML = `<strong>${esc(title)}</strong>${key ? ", " + esc(key) : ""}. ${esc(rel)}${read}.`;
  }
  fig.addEventListener("mouseover", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("focusin", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("mouseleave", () => { tip.innerHTML = defaultTip; });

  markRead();
  setMode((window.PN && PN.store.get("pn-canon-color", "key")) || "key");
  document.addEventListener("pn:read", markRead);
})();
