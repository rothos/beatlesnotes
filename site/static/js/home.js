/* Notes on … — the canon grid on the home page. */
(function () {
  "use strict";
  const fig = document.querySelector("figure.canon");
  if (!fig) return;
  const tip = document.getElementById("canon-tip");
  const legend = document.getElementById("canon-legend");
  const tiles = [...fig.querySelectorAll(".tile")];
  const defaultTip = tip.innerHTML;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // circle of fifths order; the colours are KEY_COLORS in build.py
  const FIFTHS = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
  const FIFTHS_PC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const COLORS = (document.body.dataset.keyColors || "").split(" ");

  // Legend entries that can highlight their songs carry data-hl="attr=value", matched against the tiles.
  const matches = (t, hl) => {
    const [attr, v] = hl.split("=");
    if (attr === "minor") return t.classList.contains("minor");
    if (attr === "read") return t.classList.contains("is-read") === (v === "1");
    return t.dataset[attr] === v;
  };
  const entry = (hl, swatch, label, extra = "") =>
    `<button type="button" class="lg${extra}" data-hl="${hl}" aria-pressed="false">${swatch}${label}</button>`;

  const LEGENDS = {
    key: () => FIFTHS.map((n, i) => {
      const k = tiles.filter((t) => t.dataset.pc === String(FIFTHS_PC[i])).length;
      return k ? entry(`pc=${FIFTHS_PC[i]}`, `<i style="background: ${COLORS[i]}"></i>`, `${n} <span class="n">${k}</span>`) : "";
    }).join("") +
      entry("minor", `<i class="lg-minor" style="background: var(--pencil); position: relative"></i>`, "dot: minor key", " muted"),
    written: () => `<span class="lg ramp-legend"><span>May 1989</span><i class="ramp"></i><span>2001</span></span><span class="lg muted">when Pollack first posted the note</span>`,
    writer: () => people("writer", [["lennon", "Lennon"], ["mccartney", "McCartney"], ["lennon-mccartney", "Lennon and McCartney together"], ["harrison", "Harrison"], ["starkey", "Starr"], ["all", "All four"], ["group", "Two or three of them"], ["other", "Cover"], ["", "Not in the Beatles DB"]]) +
      `<span class="lg muted">the main writer, not the official credit</span>`,
    vocal: () => people("vocal", [["lennon", "Lennon"], ["mccartney", "McCartney"], ["lennon-mccartney", "Lennon and McCartney"], ["harrison", "Harrison"], ["starkey", "Starr"], ["all", "All four"], ["group", "Shared lead"], ["none", "Instrumental"], ["", "Not in the Beatles DB"]]),
    read: () => {
      const n = tiles.filter((t) => t.classList.contains("is-read")).length;
      return entry("read=1", `<i style="background: var(--staff)"></i>`, `Read (${n} of ${tiles.length})`) +
        entry("read=0", `<i style="background: var(--paper-3)"></i>`, "Not yet") +
        (PN.readCount() ? `<span class="lg-clear"><button type="button" class="linkbtn" data-clear="ask">Clear reading history</button></span>` : "");
    },
  };

  // legend entries with counts, skipping groups no song falls into
  function people(attr, groups) {
    return groups.map(([g, label]) => {
      const n = tiles.filter((t) => t.dataset[attr] === g).length;
      if (!n) return "";
      const sw = g === "none" || !g ? `<i class="lg-hollow"></i>` : `<i style="background: var(--p-${g})"></i>`;
      return entry(`${attr}=${g}`, sw, `${label} <span class="n">${n}</span>`);
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

  // ---------------------------------------------------------------- legend highlighting
  // Hover or focus previews an entry's songs; a click pins it (so it works on touch screens too).
  let pinned = null;
  function highlight(hl) {
    fig.classList.toggle("is-hl", !!hl);
    let n = 0;
    tiles.forEach((t) => { const on = !!hl && matches(t, hl); t.classList.toggle("hl", on); n += on; });
    legend.querySelectorAll("[data-hl]").forEach((b) => b.classList.toggle("on", b.dataset.hl === hl));
    if (hl) {
      const b = legend.querySelector(`[data-hl="${hl}"]`);
      const name = b ? b.textContent.replace(/\s*\d+$/, "").replace(/\s*\(.*\)$/, "") : "";
      tip.innerHTML = `<strong>${esc(name)}</strong>: ${n} song${n === 1 ? "" : "s"} highlighted.${pinned ? " Click or tap it again to clear." : ""}`;
    } else tip.innerHTML = defaultTip;
  }
  legend.addEventListener("mouseover", (e) => { const b = e.target.closest("[data-hl]"); if (b) highlight(b.dataset.hl); });
  legend.addEventListener("focusin", (e) => { const b = e.target.closest("[data-hl]"); if (b) highlight(b.dataset.hl); });
  legend.addEventListener("mouseleave", () => highlight(pinned));
  legend.addEventListener("focusout", (e) => { if (!legend.contains(e.relatedTarget)) highlight(pinned); });
  legend.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hl]");
    if (!b) return;
    pinned = pinned === b.dataset.hl ? null : b.dataset.hl;
    legend.querySelectorAll("[data-hl]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.hl === pinned)));
    highlight(pinned || b.dataset.hl);
  });

  // clearing the reading history asks once, in place, before it forgets anything
  legend.addEventListener("click", (e) => {
    const b = e.target.closest("[data-clear]");
    if (!b) return;
    const box = b.parentElement;
    if (b.dataset.clear === "ask") {
      const n = PN.readCount();
      box.innerHTML = `Forget all ${n} note${n === 1 ? "" : "s"} you’ve read? <button type="button" class="linkbtn danger" data-clear="yes">Clear</button> <button type="button" class="linkbtn" data-clear="no">Keep</button>`;
      box.querySelector('[data-clear="no"]').focus();
    } else {
      if (b.dataset.clear === "yes") PN.clearRead();
      legend.innerHTML = LEGENDS.read();
    }
  });

  function setMode(mode) {
    if (!LEGENDS[mode]) mode = "key";
    fig.dataset.color = mode;
    fig.querySelectorAll("[data-color]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.color === mode)); });
    legend.innerHTML = LEGENDS[mode]();
    pinned = null;
    highlight(null);
    if (window.PN) PN.store.set("pn-canon-color", mode);
  }
  fig.querySelectorAll("button[data-color]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.color)));

  // on wide screens, reserve the tallest legend's height so changing modes never moves the grid;
  // on phones the legends wrap to very different heights, and a gap would cost more than the shift
  function sizeLegend() {
    legend.style.minHeight = "";
    if (innerWidth < 700) return;
    let h = 0;
    for (const m of Object.keys(LEGENDS)) { legend.innerHTML = LEGENDS[m](); h = Math.max(h, legend.offsetHeight); }
    legend.style.minHeight = h + "px";
    legend.innerHTML = LEGENDS[fig.dataset.color]();
    highlight(pinned);
  }
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { sizeLegend(); sizeTip(); }, 150); });

  function tipHTML(t, mode) {
    const [title, key, rel, written, writer, vocal] = (t.dataset.tip || "").split("|");
    const read = t.classList.contains("is-read") ? ", read" : "";
    const who = mode === "writer" && writer ? `. Written by ${esc(writer)}` : mode === "vocal" && vocal ? `. Sung by ${esc(vocal)}` : "";
    return `<strong>${esc(title)}</strong>${key ? ", " + esc(key) : ""}. ${esc(rel)}${who}${written ? ". Note first posted " + esc(written) : ""}${read}.`;
  }
  const show = (t) => { tip.innerHTML = tipHTML(t, fig.dataset.color); };

  // the label sits above the grid, so reserve the height of the longest thing it can say
  // (at the current width) and the grid never moves as it changes
  function sizeTip() {
    const probe = tip.cloneNode(false);
    probe.removeAttribute("id"); probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `position: absolute; visibility: hidden; min-height: 0; width: ${tip.clientWidth}px`;
    tip.parentNode.appendChild(probe);
    const says = [defaultTip, `<strong>Lennon and McCartney together</strong>: 212 songs highlighted. Click or tap it again to clear.`];
    for (const t of tiles) for (const m of ["key", "writer", "vocal"]) says.push(tipHTML(t, m) + ", read");
    let h = 0;
    for (const html of says) { probe.innerHTML = html; h = Math.max(h, probe.offsetHeight); }
    probe.remove();
    tip.style.minHeight = h + "px";
  }
  fig.addEventListener("mouseover", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("focusin", (e) => { const t = e.target.closest(".tile"); if (t) show(t); });
  fig.addEventListener("mouseleave", () => highlight(pinned));

  markRead();
  setMode((window.PN && PN.store.get("pn-canon-color", "key")) || "key");
  sizeLegend();
  sizeTip();
  document.addEventListener("pn:read", () => { markRead(); if (fig.dataset.color === "read") legend.innerHTML = LEGENDS.read(); });
})();
