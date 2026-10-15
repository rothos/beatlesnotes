/* Notes on … — chord charts.
   Reads Pollack's ASCII charts ("|G  |e7  |b  |D  |" over " I   vi   iii  V"), redraws them as bars,
   and plays them with a small Web Audio synth. Charts it can't read confidently stay as typed. */
(function (global) {
  "use strict";

  // ------------------------------------------------------------------ chord grammar
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const CHORD_RE = /^\(?([A-Ga-g])(#|b(?![a-z])|-flat|-sharp)?((?:-?(?:Major|Maj|minor|maj7|maj9|maj|M7|min7|min|m7|m|dim7|dim\.?|o7|o|aug\.?|\+|sus4|sus2|sus|add9|add2|7sus4|6\/9|13|11|9|7|6|half-dim|ø)\.?)*)(\/[A-Ga-g](?:#|b|-flat)?)?\)?$/;
  const QUALITY_ONLY = /^-?(7|6|9|dim\.?|dim7|aug\.?|o7|\+|maj7|sus4)$/;
  const HOLD = /^-+$|^%$/;
  const NUMERAL_RE = /^\(?(?:flat-|sharp-|b|#|♭|♯)?(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(?:[-\w\/°ø+#]*)\)?[,.]?$/;
  const LABEL_RE = /^\s*(chords?|bass(?:line)?|bottom|top|melody|tune|guitar|piano|organ|voices?|vocal|harmony)\s*:\s*$/i;
  const KEY_RE = /^\s*([A-Ga-g](?:#|b|-flat|-sharp)?)\s*:\s*$/;

  function parseChord(tok, prev) {
    if (QUALITY_ONLY.test(tok) && prev) {
      const name = (prev.minor ? prev.root.toLowerCase() : prev.root.toUpperCase()) + prev.acc + tok.replace(/^-/, "");
      const c = parseChord(name, null);
      return c && Object.assign(c, { text: name });
    }
    const m = CHORD_RE.exec(tok);
    if (!m) return null;
    const root = m[1], acc = m[2] || "", qual = (m[3] || "").replace(/^-/, "").replace(/\./g, ""), slash = m[4] || "";
    let pc = PC[root.toLowerCase()] + (acc === "#" || acc === "-sharp" ? 1 : acc === "b" || acc === "-flat" ? -1 : 0);
    pc = (pc + 12) % 12;
    let minor = root === root.toLowerCase() || /^(m|min)(?!aj)/.test(qual);
    let iv;
    const q = qual.replace(/^(min|m)(?!aj)/, "");
    if (/dim7|o7/.test(q)) iv = [0, 3, 6, 9];
    else if (/half-dim|ø/.test(q)) iv = [0, 3, 6, 10];
    else if (/dim|^o$/.test(q)) iv = [0, 3, 6];
    else if (/aug|\+/.test(q)) iv = [0, 4, 8];
    else {
      const third = /sus4/.test(q) ? 5 : /sus2/.test(q) ? 2 : minor ? 3 : 4;
      iv = [0, third, 7];
      if (/maj7|M7|maj9/.test(q)) iv.push(11);
      else if (/7|9|11|13/.test(q)) iv.push(10);
      if (/6/.test(q) && !/6\/9/.test(q)) iv.push(9);
      if (/6\/9/.test(q)) iv.push(9, 14);
      if (/9|add9|add2/.test(q) && !/6\/9/.test(q)) iv.push(14);
    }
    let bass = pc;
    if (slash) {
      const b = slash.slice(1);
      bass = (PC[b[0].toLowerCase()] + (/#/.test(b) ? 1 : /b$|-flat/.test(b) ? -1 : 0) + 12) % 12;
    }
    return { text: tok, root, acc, pc, minor, iv, bass, implied: tok.startsWith("(") };
  }

  // ------------------------------------------------------------------ chart parser
  function tokens(line, from = 0) {
    const out = [];
    const re = /[^\s|]+/g;
    let m;
    while ((m = re.exec(line))) if (m.index >= from) out.push({ t: m[0], c: m.index });
    return out;
  }

  function isNumeralLine(line, firstBar) {
    const toks = tokens(line).filter((x) => !(x.c < firstBar && KEY_RE.test(x.t)) && !/^[A-Ga-g](#|b|-flat|-sharp)?:$/.test(x.t));
    if (!toks.length) return false;
    const good = toks.filter((x) => NUMERAL_RE.test(x.t) || /^\(?(V|v|IV|ii|I|vi|iii|vii)[\w-]*-of-/.test(x.t) || /^[-–(]+$/.test(x.t) || /^\(?(V|IV|I)\)?$/.test(x.t));
    return good.length / toks.length >= 0.6;
  }

  const isRepeatLabel = (l) => /^\s*-*\s*\d+\s*[xX]\s*-*\s*$/.test(l) || /^\s*[-\s]*\d\s*X[-\s]*$/.test(l) || /^\s*\*\*.*\*\*\s*$/.test(l);

  function parseBarLine(line) {
    const first = line.indexOf("|");
    const prefix = line.slice(0, first);
    const bars = [];
    let start = first;
    for (let i = first + 1; i < line.length; i++) {
      if (line[i] === "|") { if (i - start > 1) bars.push({ s: start, e: i, text: line.slice(start + 1, i) }); start = i; }
    }
    const tail = line.slice(start + 1).trim();
    return { prefix, bars, tail, first };
  }

  const isBarLine = (l) => (l.match(/\|/g) || []).length >= 2;
  const KEYTOK = /^\(?([A-Ga-g](?:#|b|-flat|-sharp)?):\)?$/;

  function readBars(line, bl, role) {
    let prev = null, ok = 0, bad = 0, n = 0;
    const segs = bl.bars.slice();
    // "|A ..." — a final bar left open
    if (bl.tail && /^[A-Ga-g]/.test(bl.tail)) segs.push({ s: bl.bars.length ? bl.bars[bl.bars.length - 1].e : bl.first, e: line.length + 1, open: true });
    const bars = segs.map((b) => {
      const beats = [];
      tokens(line.slice(0, b.e), b.s + 1).forEach((x) => {
        if (/^[*.]+$|^-+>$|^\.\.\.$/.test(x.t)) return;
        n++;
        if (HOLD.test(x.t)) { beats.push({ hold: true, c: x.c, text: "–" }); ok++; return; }
        const ch = role === "chords" || role === "bass" ? parseChord(x.t, prev) : null;
        if (ch) { beats.push({ chord: ch, c: x.c, text: ch.text }); prev = ch; ok++; }
        else { beats.push({ text: x.t, c: x.c }); bad++; }
      });
      return { s: b.s, e: b.e, beats, open: b.open };
    });
    return { bars, ok, bad, n };
  }

  function attach(bars, line, field, minCol) {
    // put each token of an annotation line under the nearest beat
    const all = [];
    bars.forEach((b) => b.beats.forEach((bt) => all.push(bt)));
    let keyPrefix = "";
    tokens(line).forEach((n) => {
      if (n.c < minCol && KEYTOK.test(n.t)) return;
      if (KEYTOK.test(n.t)) { keyPrefix = n.t.replace(/[()]/g, "") + " "; return; }
      let best = null, bd = 5;
      all.forEach((bt) => { const d = Math.abs(bt.c - n.c); if (d < bd) { bd = d; best = bt; } });
      if (!best) {
        const bar = bars.find((b) => n.c > b.s && n.c < b.e);
        if (bar) { best = { c: n.c, text: "", empty: true }; bar.beats.push(best); bar.beats.sort((a, b) => a.c - b.c); all.push(best); }
      }
      if (!best) return;
      const val = keyPrefix + n.t;
      keyPrefix = "";
      best[field] = best[field] ? best[field] + " " + val : val;
    });
  }

  function parse(text) {
    const lines = text.replace(/\t/g, "    ").split("\n");
    const systems = [];
    let key = null, unknown = 0, chordRows = 0, labelBuf = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) { continue; }
      if (!isBarLine(line)) { labelBuf.push(line.trim()); continue; }

      const bl = parseBarLine(line);
      let role = "chords", rowLabel = null;
      const lab = LABEL_RE.exec(bl.prefix);
      const k = KEY_RE.exec(bl.prefix);
      if (lab) { role = /bass|bottom/i.test(lab[1]) ? "bass" : /chord/i.test(lab[1]) ? "chords" : "other"; rowLabel = lab[1]; }
      else if (k) key = key || k[1];
      else if (bl.prefix.trim()) { rowLabel = bl.prefix.trim().replace(/:$/, ""); role = "other"; }

      // following annotation lines: numerals first, then anything short that sits under the bars
      const after = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !isBarLine(lines[j])) {
        const l = lines[j];
        const numeral = isNumeralLine(l, bl.first);
        const nextBar = (() => { let q = j + 1; while (q < lines.length && !lines[q].trim()) q++; return q < lines.length && isBarLine(lines[q]) && q === j + 1; })();
        if (!numeral && nextBar && after.length) break;          // probably a label for the next system
        if (!numeral && tokens(l).length > 8) break;               // prose, not an annotation
        after.push({ l, numeral });
        j++;
      }
      const hasNumerals = after.some((a) => a.numeral);
      let r = readBars(line, bl, role);
      const avg = r.n / Math.max(1, r.bars.length);
      if (role === "chords" && (r.bad > 0 || r.ok === 0 || (!hasNumerals && avg > 2.5))) {
        role = "other";
        r = readBars(line, bl, role);
      }
      if (role === "chords") chordRows++;
      after.forEach((a, idx) => {
        const kk = /^\s*([A-Ga-g](?:#|b|-flat|-sharp)?)\s*:/.exec(a.l);
        if (kk && a.l.indexOf(":") <= bl.first + 1 && idx === 0) key = key || kk[1];
        attach(r.bars, a.l, a.numeral ? (idx === 0 || !after[0].numeral ? "rn" : "rn2") : "note", bl.first);
      });
      i = j - 1;
      const label = labelBuf.filter((x) => !/^[-\s]*$/.test(x)).map((x) => x.replace(/\*\*/g, "").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim()).join(" / ") || null;
      labelBuf = [];
      systems.push({ role, label: [label, rowLabel && role !== "chords" ? rowLabel : null].filter(Boolean).join(" — ") || null, bars: r.bars });
    }
    if (labelBuf.length && systems.length) systems[systems.length - 1].after = labelBuf.join(" ");
    // A chart is worth drawing if it is mostly chords
    const otherRows = systems.filter((s) => s.role === "other").length;
    const ok = chordRows > 0 && otherRows <= chordRows && unknown === 0;
    return { ok, key, systems };
  }

  // ------------------------------------------------------------------ pretty printing
  function prettyChord(t) {
    let s = t.replace(/-flat/g, "♭").replace(/-sharp/g, "♯").replace(/^([A-Ga-g])b/, "$1♭").replace(/#/g, "♯");
    const m = /^(\(?[A-Ga-g][♭♯]?)(.*?)(\)?)$/.exec(s);
    if (!m) return escapeHtml(s);
    let q = m[2].replace(/^-/, "").replace(/dim\.?7/, "°7").replace(/dim\.?|^o$/, "°").replace(/half-dim/, "ø").replace(/aug\.?/, "+");
    return escapeHtml(m[1]) + (q ? "<sup>" + escapeHtml(q) + "</sup>" : "") + escapeHtml(m[3]);
  }
  function prettyNumeral(t) {
    return escapeHtml(t.replace(/^flat-/, "♭").replace(/^sharp-/, "♯").replace(/-flat/g, "♭").replace(/-dim7?/g, (x) => x.endsWith("7") ? "°7" : "°").replace(/-of-/g, " of "));
  }
  const prettyKey = (k) => k.replace(/-flat/, "♭").replace(/-sharp/, "♯").replace(/^([A-Ga-g])b$/, "$1♭").replace(/#/, "♯");
  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

  // ------------------------------------------------------------------ audio
  let ctx = null, master = null, current = null;

  function audio() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.4;
      // a short, soft room made from two filtered delays
      const dl = ctx.createDelay(); dl.delayTime.value = 0.09;
      const fb = ctx.createGain(); fb.gain.value = 0.28;
      const wet = ctx.createGain(); wet.gain.value = 0.18;
      master.connect(lp); lp.connect(ctx.destination);
      lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function voice(chord, prevVoicing) {
    // keep chord tones in a warm middle register, close to the previous chord
    const centre = prevVoicing ? prevVoicing.reduce((a, b) => a + b, 0) / prevVoicing.length : 62;
    const notes = chord.iv.map((i) => {
      const pc = (chord.pc + i) % 12;
      let m = 48 + pc;
      while (m < centre - 6) m += 12;
      while (m > centre + 6) m -= 12;
      return m;
    });
    notes.sort((a, b) => a - b);
    let bass = 36 + chord.bass;
    if (bass > 45) bass -= 12;
    return { notes, bass };
  }

  function strike(t, dur, v, vel) {
    const out = ctx.createGain();
    out.connect(master);
    const end = t + dur;
    const all = v.notes.map((m) => [m, 0.16]).concat([[v.bass, 0.32]]);
    all.forEach(([m, amp]) => {
      const g = ctx.createGain();
      const a = amp * vel;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.012);
      g.gain.exponentialRampToValueAtTime(a * 0.45, t + 0.35);
      g.gain.setValueAtTime(a * 0.45, Math.max(t + 0.35, end - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
      g.connect(out);
      [["triangle", 0], ["sine", 4]].forEach(([type, cents]) => {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = midiHz(m); o.detune.value = cents;
        o.connect(g); o.start(t); o.stop(end + 0.3);
      });
    });
  }

  function stop() {
    if (!current) return;
    current.timers.forEach(clearTimeout);
    current.fig.querySelectorAll(".bar.playing").forEach((b) => b.classList.remove("playing"));
    current.btn.setAttribute("aria-pressed", "false");
    current.btn.setAttribute("aria-label", "Play this progression");
    current.btn.innerHTML = PLAY_ICON;
    try { current.out && current.out.disconnect(); } catch (e) { /* ignore */ }
    if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.03); setTimeout(() => master && (master.gain.value = 0.22), 120); }
    current = null;
  }

  function play(fig, model, btn, bpm, beatsPerBar) {
    if (current && current.fig === fig) { stop(); return; }
    stop();
    audio();
    const secPerBeat = 60 / bpm;
    const barDur = secPerBeat * beatsPerBar;
    const t0 = ctx.currentTime + 0.08;
    const timers = [];
    let t = t0, last = null, voicing = null;
    const barEls = fig.querySelectorAll(".bars .bar[data-playable]");
    let barIndex = 0;
    model.systems.forEach((sys) => {
      if (sys.role !== "chords") return;
      sys.bars.forEach((bar) => {
        const el = barEls[barIndex++];
        const width = Math.max(1, bar.e - bar.s);
        const events = bar.beats.filter((b) => b.chord || b.hold || b.empty).map((b) => ({
          b, at: Math.min(beatsPerBar - 1, Math.max(0, Math.round(((b.c - bar.s - 1) / width) * beatsPerBar))),
        }));
        // two chords on the same beat: spread them evenly instead
        for (let i = 1; i < events.length; i++) if (events[i].at <= events[i - 1].at) {
          events.forEach((e, j) => (e.at = (j * beatsPerBar) / events.length)); break;
        }
        if (!events.length) events.push({ b: { hold: true }, at: 0 });
        if (events[0].at > 0) events.unshift({ b: { hold: true }, at: 0 });
        const barStart = t;
        timers.push(setTimeout(() => {
          fig.querySelectorAll(".bar.playing").forEach((x) => x.classList.remove("playing"));
          el && el.classList.add("playing");
        }, Math.max(0, (barStart - ctx.currentTime) * 1000)));
        events.forEach((e, j) => {
          const st = barStart + e.at * secPerBeat;
          const en = j + 1 < events.length ? barStart + events[j + 1].at * secPerBeat : barStart + barDur;
          const chord = e.b.chord || last;
          if (!chord) return;
          voicing = e.b.chord ? voice(chord, voicing && voicing.notes) : voicing || voice(chord, null);
          strike(st, en - st, voicing, e.b.chord ? (chord.implied ? 0.55 : 1) : 0.5);
          last = chord;
        });
        t += barDur;
      });
    });
    timers.push(setTimeout(stop, (t - ctx.currentTime) * 1000 + 300));
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", "Stop");
    btn.innerHTML = STOP_ICON;
    current = { fig, btn, timers };
  }

  const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z" fill="currentColor"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

  // ------------------------------------------------------------------ rendering
  function render(fig, opts = {}) {
    const pre = fig.querySelector(".chart-src");
    if (!pre || fig.classList.contains("drawn")) return;
    const model = parse(pre.textContent);
    if (!model.ok) { fig.classList.add("undrawn"); return; }
    const beatsPerBar = opts.beatsPerBar || 4;
    const wrap = document.createElement("div");
    wrap.className = "bars";
    const key = model.key ? prettyKey(model.key) : null;
    const tempoId = "tempo-" + Math.random().toString(36).slice(2, 8);
    wrap.innerHTML =
      `<div class="bars-head"><button type="button" class="playbtn" aria-pressed="false" aria-label="Play this progression">${PLAY_ICON}</button>` +
      (key ? `<span class="bars-key">in ${escapeHtml(key)}</span>` : "") +
      `<label class="tempo" for="${tempoId}">Tempo <input id="${tempoId}" type="range" min="50" max="180" step="2" value="${opts.bpm || 104}"><output>${opts.bpm || 104} bpm</output></label></div>`;
    model.systems.forEach((sys) => {
      const row = document.createElement("div");
      row.className = "bar-row" + (sys.role === "bass" ? " bassline" : sys.role === "other" ? " otherline" : "");
      const labelText = sys.label || (sys.role === "bass" ? "Bass line" : "");
      if (labelText) { const p = document.createElement("p"); p.className = "bar-row-label"; p.textContent = labelText; wrap.appendChild(p); }
      sys.bars.forEach((bar) => {
        const b = document.createElement("div");
        b.className = "bar";
        if (sys.role === "chords") b.dataset.playable = "";
        b.innerHTML = (bar.beats.length ? bar.beats : [{ hold: true, text: "" }]).map((bt) => {
          const ch = bt.chord ? prettyChord(bt.text) : bt.hold ? "–" : escapeHtml(bt.text || "");
          const cls = bt.hold || bt.empty ? "ch hold" : "ch";
          return `<span class="beat"><span class="${cls}">${ch || "&nbsp;"}</span><span class="rn">${bt.rn ? prettyNumeral(bt.rn) : ""}</span>` +
            (bt.rn2 ? `<span class="rn rn2">${prettyNumeral(bt.rn2)}</span>` : "") +
            (bt.note ? `<span class="bnote">${escapeHtml(bt.note)}</span>` : "") + `</span>`;
        }).join("");
        row.appendChild(b);
      });
      wrap.appendChild(row);
      if (sys.after) { const p = document.createElement("p"); p.className = "bar-row-label"; p.textContent = sys.after; wrap.appendChild(p); }
    });
    fig.insertBefore(wrap, pre);
    fig.classList.add("drawn");
    const cap = fig.querySelector("figcaption") || fig.appendChild(document.createElement("figcaption"));
    const tg = document.createElement("button");
    tg.type = "button"; tg.className = "chart-toggle"; tg.textContent = "Show as typed";
    tg.addEventListener("click", () => {
      const on = fig.classList.toggle("show-src");
      tg.textContent = on ? "Hide typed version" : "Show as typed";
    });
    cap.appendChild(tg);
    const btn = wrap.querySelector(".playbtn");
    const slider = wrap.querySelector(".tempo input");
    const out = wrap.querySelector(".tempo output");
    slider.addEventListener("input", () => { out.textContent = slider.value + " bpm"; });
    btn.addEventListener("click", () => play(fig, model, btn, +slider.value, beatsPerBar));
  }

  const api = { parse, parseChord, render, stop };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    global.PNCharts = api;
    const init = () => {
      const art = document.querySelector("article.essay");
      const meter = art && art.dataset.meter;
      const m = /^(\d+)\/(\d+)/.exec(meter || "");
      let beats = m ? +m[1] : 4;
      if (m && m[2] === "8" && beats % 3 === 0) beats = beats / 3;  // compound meters: count the big beats
      if (beats < 2 || beats > 7) beats = 4;
      document.querySelectorAll("figure.chart").forEach((f) => render(f, { beatsPerBar: beats }));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") stop(); });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
