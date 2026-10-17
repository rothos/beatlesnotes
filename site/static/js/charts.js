/* Notes on … — chord charts.
   Reads Pollack's ASCII charts ("|G  |e7  |b  |D  |" over " I   vi   iii  V"), redraws them as bars,
   and plays them with a small Web Audio synth. Charts it can't read confidently stay as typed. */
(function (global) {
  "use strict";

  // ------------------------------------------------------------------ chord grammar
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const CHORD_RE = /^\(?([A-Ga-g])(#|b|-flat|-sharp|x)?((?:-?(?:Major|Maj|minor|maj7|maj9|maj|M7|min7|min|m7|m|dim7|dim\.?|o7|o|aug\.?|\+|sus4|sus2|sus|add9|add2|7sus4|6\/9|13|11|9|7|6|half-dim|ø)\.?)*)(\/[A-Ga-g](?:#|b|-flat)?)?\)?$/;
  const QUALITY_ONLY = /^-?(7|6|9|dim\.?|dim7|aug\.?|o7|\+|maj7|sus4)$/;
  const HOLD = /^-+$|^%$/;
  const NUMERAL_RE = /^\(?(?:flat-|sharp-|b|#|♭|♯)?(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(?:[-\w\/°ø+#]*)\)?[,.]?$/;
  const LABEL_RE = /^\s*(chords?|bass(?:line)?|bottom|top|melody|tune|guitar|piano|organ|voices?|vocal|harmony)\s*:\s*$/i;
  const KEY_RE = /^\s*([A-Ga-g](?:#|b|-flat|-sharp)?)\s*:\s*$/;

  const FIGURE_RE = /^(\(?[A-Ga-g](?:#|b(?![a-z])|-flat|-sharp)?)(7)?(6\/4|6\/3|6\/5|4\/3|4\/2)(\)?)$/;
  const INVERSION = { "6/3": 1, "6/5": 1, "6/4": 2, "4/3": 2, "4/2": 3 };

  // Pollack's many spellings of the same chord, reduced to one grammar
  function normChord(tok) {
    let t = tok.replace(/\?/g, "").replace(/\*+$/, "");
    t = t.replace(/^(\(?[A-Ga-g])-?nat(?:ural)?\.?/i, "$1").replace(/\(nat(?:ural)?\)$/i, "").replace(/-added$/, "");  // F-nat7, E-natural, e7(natural)
    t = t.replace(/-?diminished/i, "dim").replace(/-?augmented|-Aug$/i, "aug").replace(/-?#5(\(aug\))?$/, "aug");
    t = t.replace(/Maj\.?-7th/i, "maj7");
    t = t.replace(/(?:7|9|11|13)(?:\/(?:7|9|11|13))+/, (m) => String(Math.max(...m.split("/").map(Number))));  // 7/9 -> 9
    t = t.replace(/^(\(?[A-Ga-g](?:#|b)?)4(?:-3)?(\)?)$/, "$1sus4$2");              // C4, C4-3: a suspended fourth
    return t;
  }

  function parseChord(tok, prev) {
    const orig = tok;
    tok = normChord(tok);
    if (tok !== orig) { const c = parseChord(tok, prev); return c && Object.assign(c, { text: orig }); }
    const fm = FIGURE_RE.exec(tok);
    if (fm) {
      const base = parseChord(fm[1] + (fm[2] || "") + (/^(6\/5|4\/3|4\/2)$/.test(fm[3]) ? "7" : "") + fm[4], null);
      if (!base) return null;
      const inv = INVERSION[fm[3]];
      return Object.assign(base, { text: tok, bass: (base.pc + base.iv[Math.min(inv, base.iv.length - 1)]) % 12 });
    }
    if (QUALITY_ONLY.test(tok) && prev) {
      const name = (prev.minor ? prev.root.toLowerCase() : prev.root.toUpperCase()) + prev.acc + tok.replace(/^-/, "");
      const c = parseChord(name, null);
      return c && Object.assign(c, { text: name });
    }
    const m = CHORD_RE.exec(tok);
    if (!m) return null;
    const root = m[1], acc = m[2] || "", qual = (m[3] || "").replace(/^-/, "").replace(/\./g, ""), slash = m[4] || "";
    let pc = PC[root.toLowerCase()] + (acc === "#" || acc === "-sharp" ? 1 : acc === "x" ? 2 : acc === "b" || acc === "-flat" ? -1 : 0);
    pc = (pc + 12) % 12;
    let minor = root === root.toLowerCase() || /^(m|min)(?!aj)/.test(qual);
    let iv;
    const q = qual.replace(/^(min|m)(?!aj)/, "");
    if (/half-dim|ø/.test(q)) iv = [0, 3, 6, 10];
    else if (/dim7|o7/.test(q)) iv = [0, 3, 6, 9];
    else if (/dim|^o$/.test(q)) iv = [0, 3, 6];
    else if (/aug|\+/.test(q)) iv = [0, 4, 8];
    else {
      const third = /sus4/.test(q) ? 5 : /sus2/.test(q) ? 2 : minor ? 3 : 4;
      iv = [0, third, 7];
      if (/maj7|M7|maj9/.test(q)) iv.push(11);
      else if (/7|9|11|13/.test(q)) iv.push(10);
      if (/11|13/.test(q)) iv.push(14);
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
  // A chart is a list of systems. A system is one bar line, or several bar lines typed one above the
  // other that sound together ("Soprano: |...", "Bass: |...", "Chords: |..."). Each row has a role:
  //   chords  chord symbols, played as chords
  //   bass    a bass line, played as single low notes (and the chords then leave out their own bass)
  //   voice   any other line of note names (melody, inner voice, topline...), played as single notes
  //   other   words, rhythms, anything else: drawn, not played
  const RUN_RE = /^-*(?:(?:[A-G](?:#|b)?){2,}|[A-Ga-g](?:#|b)?(?:-+[A-Ga-g](?:#|b)?)+)-*$/;   // "CEG", "e-d#-d": quick notes in one word
  const PITCH_RE = /^\(?([A-Ga-g])(#|b|-flat|-sharp|-nat(?:ural)?|♭|♯)?\)?[,.]?$/;
  const DECOR_RE = /^(\d+(?:\/\d+)*|susp?\.?|sus\d|minor|augmented|aug\.?|\(aug\)|half(?:-dim\.?7?)?|dim\.?(?:7|\d\/\d)?|maj\.?7|added|6th|7th|major|dominant)$/i;
  const IGNORE_RE = /^(etc\.?|\?|\(nat(?:ural)?\)|\d+X|I|\*+|-+>?|\.+|&|or)$/;

  // a word written after a chord changes it: "f# minor", "d# half dim.7", "G added 6th", "A dim.4/3"
  function decorate(ch, w) {
    const x = w.toLowerCase();
    if (x === "minor") { ch.minor = true; ch.iv[1] = 3; }
    else if (x === "major") { ch.minor = false; ch.iv[1] = 4; }
    else if (x === "dominant" && ch.iv.length === 3) ch.iv = ch.iv.concat(10);
    else if (/^(augmented|aug\.?|\(aug\))$/.test(x)) ch.iv = [0, 4, 8];
    else if (/^half/.test(x)) ch.iv = [0, 3, 6, 10];
    else if (/^dim/.test(x)) { ch.iv = ch.iv.length > 3 || /7|\//.test(x) ? [0, 3, 6, 9] : [0, 3, 6]; if (ch.half) ch.iv = [0, 3, 6, 10]; }
    else if (/^maj\.?7$/.test(x)) ch.iv = [0, ch.iv[1], 7, 11];
    else if (x === "6th" && ch.added) ch.iv = ch.iv.concat(9);
    if (/^half/.test(x)) ch.half = true;
    if (x === "added") ch.added = true;
    const inv = /(\d\/\d)$/.exec(x);
    if (inv && INVERSION[inv[1]] !== undefined) ch.bass = (ch.pc + ch.iv[Math.min(INVERSION[inv[1]], ch.iv.length - 1)]) % 12;
  }
  const ROW_LABEL_RE = /^\s*([A-Za-z][A-Za-z0-9 \-'#]*?)\s*:/;

  function pitchOf(tok) {
    const m = PITCH_RE.exec(tok) || PITCH_RE.exec(tok.replace(/(?:[-*+]+|\d+)$/, ""));
    if (!m) return null;
    const a = m[2] || "";
    return (PC[m[1].toLowerCase()] + (/#|sharp|♯/.test(a) ? 1 : /^b$|flat|♭/.test(a) ? -1 : 0) + 12) % 12;
  }

  function rowRole(label) {
    const l = label.toLowerCase().trim();
    if (/^(chords?|harmony|implied harmony)$/.test(l)) return "chords";
    if (/^(bass|bass[ -]?line|bottom)$/.test(l)) return "bass";
    if (/drum|rhythm|beat|pulse|word|tambourine|measure|lyric|verse|refrain|instrument/.test(l)) return "other";
    return "voice";
  }

  // where a single note line sits: centre of its register, as a MIDI note
  function registerOf(row) {
    const l = (row.label || "").toLowerCase();
    if (row.role === "bass") return 45;
    if (!row.label && row.voiceIndex !== undefined) return [69, 62, 55, 50][Math.min(3, row.voiceIndex)];
    if (/tenor/.test(l)) return 55;
    if (/alto|inner|middle|mid/.test(l)) return 62;
    return 69;  // soprano, top line, melody, tune, lead ...
  }

  function tokens(line, from = 0) {
    const out = [];
    const re = /[^\s|]+/g;
    let m;
    while ((m = re.exec(line))) if (m.index >= from) out.push({ t: m[0], c: m.index });
    return out;
  }

  function isNumeralLine(line, firstBar) {
    // (inversion figures like "6/5" and footnote stars don't count either way)
    const toks = tokens(line).filter((x) => !(x.c < firstBar && KEY_RE.test(x.t)) && !/^[A-Ga-g](#|b|-flat|-sharp)?:$/.test(x.t) && !/^(\d+(\/\d+)*|\*+)$/.test(x.t));
    if (!toks.length) return false;
    const good = toks.filter((x) => NUMERAL_RE.test(x.t) || /^\(?(V|v|IV|ii|I|vi|iii|vii)[\w-]*-of-/.test(x.t) || /^[-–(]+$/.test(x.t) || /^\(?(V|IV|I)\)?$/.test(x.t));
    return good.length / toks.length >= 0.6;
  }

  const isPitchLine = (line, from) => {
    const toks = tokens(line, from).filter((x) => !HOLD.test(x.t) && !/^[*.]+$/.test(x.t) && !/^\(?nat(?:ural)?\.?\)?$/i.test(x.t) && !IGNORE_RE.test(x.t));
    return toks.length > 0 && toks.filter((x) => pitchOf(x.t) !== null || RUN_RE.test(x.t) || /^\(?rest\)?$/i.test(x.t)).length / toks.length >= 0.75;
  };

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

  const isBarLine = (l) => {
    if ((l.match(/\|/g) || []).length < 2) return false;
    // a line of numerals that happens to contain bar lines (" I   IV   I  |-  |") is an annotation
    const body = tokens(l.replace(/\|/g, " ")).filter((x) => !HOLD.test(x.t) && !/:$/.test(x.t));
    return !(body.length && body.every((x) => NUMERAL_RE.test(x.t) && pitchOf(x.t) === null && !parseChord(x.t, null)));
  };
  const KEYTOK = /^\(?([A-Ga-g](?:#|b|-flat|-sharp)?):\)?$/;

  // read the tokens of each bar of a row according to its role
  function readBars(line, segs, role) {
    let prev = null, ok = 0, bad = 0, n = 0;
    const bars = segs.map((b) => {
      const beats = [];
      tokens(line.slice(0, b.e), b.s + 1).forEach((x) => {
        if (/^[*.]+$|^-+>$|^\.\.\.$/.test(x.t)) return;
        n++;
        if (HOLD.test(x.t)) { beats.push({ hold: true, c: x.c, text: "–" }); ok++; return; }
        if (role === "chords") {
          const last = beats[beats.length - 1];
          // "E 6/4", "- 7", "- susp": a figure written after a chord belongs to it
          if (last && DECOR_RE.test(x.t) && !(QUALITY_ONLY.test(x.t) && last.chord)) {
            const target = last.chord || [...beats].reverse().find((bt) => bt.chord)?.chord || prev;
            if (target) { decorate(target, x.t); if (INVERSION[x.t] !== undefined) target.bass = (target.pc + target.iv[Math.min(INVERSION[x.t], target.iv.length - 1)]) % 12; }
            last.fig = last.fig ? last.fig + " " + x.t : x.t;
            n--; return;
          }
          // ignorable words, and a figure with no chord before it
          if (IGNORE_RE.test(x.t) || (DECOR_RE.test(x.t) && !last && !prev)) { n--; return; }
          // a riff written among the chords ("CCD", "DA"): quick single notes
          if (RUN_RE.test(x.t) && !parseChord(x.t, prev)) {
            const notes = x.t.match(/[A-Ga-g](?:#|b(?![a-z]))?/g);
            notes.forEach((nn, k) => beats.push({ pitch: pitchOf(nn), c: x.c + Math.round((k * x.t.length) / notes.length), text: nn, riff: true }));
            ok++; return;
          }
          const ch = parseChord(x.t, prev);
          if (ch) { beats.push({ chord: ch, c: x.c, text: ch.text }); prev = ch; ok++; return; }
        } else if (role === "bass" || role === "voice") {
          const pc = pitchOf(x.t);
          if (pc !== null) { beats.push({ pitch: pc, c: x.c, text: x.t.replace(/[()]/g, "").replace(/(?:[-*+]+|\d+)$/, "") }); ok++; return; }
          if (RUN_RE.test(x.t)) {
            const notes = x.t.match(/[A-Ga-g](?:#|b(?![a-z]))?/g);
            notes.forEach((nn, k) => beats.push({ pitch: pitchOf(nn), c: x.c + Math.round((k * x.t.length) / notes.length), text: nn, run: k > 0 }));
            ok++; return;
          }
          if (/^\(?rest\)?$/i.test(x.t)) { beats.push({ rest: true, c: x.c, text: "rest" }); ok++; return; }
          if (/^\(?nat(?:ural)?\.?\)?$/i.test(x.t) || IGNORE_RE.test(x.t)) { n--; return; }
        }
        beats.push({ text: x.t, c: x.c, word: true }); bad++;
      });
      return { s: b.s, e: b.e, beats, open: b.open };
    });
    return { bars, ok, bad, n };
  }

  function segments(line, bl) {
    const segs = bl.bars.slice();
    // "|A ..." — a final bar left open
    if (bl.tail && (/^[A-Ga-g(]/.test(bl.tail) || /^-(\s|$)/.test(bl.tail))) segs.push({ s: bl.bars.length ? bl.bars[bl.bars.length - 1].e : bl.first, e: line.length + 1, open: true });
    return segs;
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

  // one bar line -> { label, role, line, bl }
  // "(next verse)", "(cut off after second beat)", "**rapidly walking bass ...": words, not music
  const blankRemarks = (line) => line
    .replace(/\((?=[^)]*[a-z]{3})(?![A-Ga-g](?:#|b)?\??\))[^)|]*\)?/g, (m) => /^\((nat|natural|aug)\)$/i.test(m) ? m : " ".repeat(m.length))
    .replace(/\*\*[^|]*/g, (m) => " ".repeat(m.length));

  function rowHead(raw) {
    const line = blankRemarks(raw);
    const bl = parseBarLine(line);
    const k = KEY_RE.exec(bl.prefix);
    if (!bl.prefix.trim()) return { line, bl, label: null, role: null };
    if (k) return { line, bl, label: null, role: null, key: k[1] };
    const lab = ROW_LABEL_RE.exec(bl.prefix);
    // notes or chords typed before the first bar line are a pickup: "Bassline: A G# |F# ...", "E7 f#7 |g#7 ..."
    const from = lab ? bl.prefix.indexOf(lab[0]) + lab[0].length : 0;
    const pre = tokens(bl.prefix, from);
    const pickup = pre.length && pre.every((x) => parseChord(x.t, null) || pitchOf(x.t) !== null || RUN_RE.test(x.t) || HOLD.test(x.t))
      ? { s: pre[0].c - 1, e: bl.first, pickup: true } : null;
    if (lab && lab[1].trim().split(/\s+/).length > 3) return { line, raw, bl, label: null, role: null, caption: lab[1].trim() };
    if (lab) return { line, raw, bl, label: lab[1].trim(), role: rowRole(lab[1]), pickup };
    if (pickup) return { line, raw, bl, label: null, role: null, pickup };
    return { line, raw, bl, label: bl.prefix.trim(), role: "other" };
  }

  // A tune drawn as a graph: each note on its own line by height, placed across the bar by when it
  // falls (Norwegian Wood 78.1; the riff over Lucy's descending line, 108.1). Lines next to one another
  // that never have notes in the same place are laid over one another as a single line of notes.
  function mergeGraphs(heads) {
    const out = [];
    for (let i = 0; i < heads.length; ) {
      let j = heads.length;
      while (j > i + 1 && !mergeGraph(heads.slice(i, j))) j--;
      out.push(j > i + 1 ? mergeGraph(heads.slice(i, j)) : heads[i]);
      i = j > i + 1 ? j : i + 1;
    }
    return out.length < heads.length ? out : null;
  }
  function mergeGraph(heads) {
    if (heads.length < 2 || heads.some((h) => h.label || h.pickup || h.key || h.caption || h.bl.prefix.trim())) return null;
    const bars = (l) => [...l].map((c, i) => (c === "|" ? i : -1)).filter((i) => i >= 0).join(",");
    if (heads.some((h) => bars(h.line) !== bars(heads[0].line))) return null;
    const width = Math.max(...heads.map((h) => h.line.length));
    const out = Array(width).fill(" "), from = Array(width).fill(-1);
    let rowsWithNotes = 0;
    for (let r = 0; r < heads.length; r++) {
      const toks = tokens(heads[r].line, 0).filter((x) => x.t !== "|");
      if (toks.some((x) => pitchOf(x.t) === null && !RUN_RE.test(x.t) && !HOLD.test(x.t))) return null;
      if (toks.some((x) => pitchOf(x.t) !== null)) rowsWithNotes++;
      for (const x of toks) for (let c = x.c; c < x.c + x.t.length; c++) {
        if (from[c] >= 0) return null;   // two lines have notes in the same place: these sound together
        from[c] = r;
      }
      [...heads[r].line].forEach((ch, c) => { if (ch !== " " && out[c] === " ") out[c] = ch; });
    }
    if (rowsWithNotes < heads.length - 1 || rowsWithNotes < 2) return null;
    // two lines: only a graph if they take turns within bars, not one line simply resting while the other plays
    if (heads.length === 2) {
      const bl = [...heads[0].line].map((c, i) => (c === "|" ? i : -1)).filter((i) => i >= 0);
      let turns = 0;
      for (let k = 0; k + 1 < bl.length; k++) {
        const rows = new Set(from.slice(bl[k], bl[k + 1]).filter((r) => r >= 0));
        if (rows.size === 2) turns++;
      }
      if (turns < 2) return null;
    }
    for (let c = 1; c < width; c++) if (from[c] >= 0 && from[c - 1] >= 0 && from[c] !== from[c - 1]) return null;  // notes would run together
    const h = rowHead(out.join("").replace(/\s+$/, ""));
    h.role = "voice";
    // the graph gives each note's height: count up from the bottom line, each a step above the last
    const rowMidi = [];
    let last = null;
    for (let r = heads.length - 1; r >= 0; r--) {
      const t = tokens(heads[r].line, 0).find((x) => pitchOf(x.t) !== null || RUN_RE.test(x.t));
      if (!t) continue;
      const pc = pitchOf(t.t) ?? pitchOf(t.t.match(/^[A-G](#|b)?/)[0]);
      let m = last === null ? 57 : last + 1;   // the lowest note between A3 and G#4
      while (((m % 12) + 12) % 12 !== pc) m++;
      rowMidi[r] = last = m;
    }
    // a tune: its top note between F#4 and F5
    const hi = Math.max(...rowMidi.filter((x) => x !== undefined));
    const lift = hi < 66 ? 12 : 0;
    rowMidi.forEach((x, r) => { if (x !== undefined) rowMidi[r] = x + lift; });
    h.graphMidi = from.map((r) => (r >= 0 ? rowMidi[r] : undefined));
    return h;
  }

  // roles for rows typed one above another without labels: the lowest row that looks like harmony
  // (minor chords in lower case, chord qualities, held chords) is the chords; note lines above it are voices
  function inferRoles(heads) {
    const info = heads.map((h) => {
      const toks = tokens(h.line, h.bl.first).filter((x) => !/^[*.]+$|^\.\.\.$/.test(x.t));
      const holds = toks.filter((x) => HOLD.test(x.t)).length;
      const notes = toks.filter((x) => !HOLD.test(x.t) && !DECOR_RE.test(x.t) && !IGNORE_RE.test(x.t));
      const musical = notes.length > 0 && notes.filter((x) => parseChord(x.t, null) || pitchOf(x.t) !== null || RUN_RE.test(x.t)).length / notes.length >= 0.7;
      const marked = notes.some((x) => /^\(?[a-g]/.test(x.t) || /\d|dim|aug|maj|sus|m7|\//.test(x.t.slice(1))) || holds / Math.max(1, toks.length) >= 0.3;
      return { musical, marked };
    });
    let chordsAt = -1;
    for (let n = heads.length - 1; n >= 0; n--) if (info[n].musical && info[n].marked) { chordsAt = n; break; }
    const musical = info.map((x, n) => (x.musical && !heads[n].role ? n : -1)).filter((n) => n >= 0);
    if (chordsAt < 0 && musical.length === 1 && !heads.some((h) => h.role === "chords")) chordsAt = musical[0];
    let v = 0;
    heads.forEach((h, n) => {
      if (h.graphMidi) v++;   // a tune drawn as a graph counts as the top voice
      if (h.role) return;
      if (!info[n].musical) h.role = "other";
      else if (n === chordsAt) h.role = "chords";
      else if (chordsAt >= 0 && n > chordsAt) h.role = "bass";
      else { h.role = "voice"; h.voiceIndex = v++; }
    });
  }

  function parse(text, opts = {}) {
    const lines = text.replace(/\t/g, "    ").split("\n");
    const systems = [];
    let key = null, labelBuf = [], prevMulti = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (!isBarLine(line)) { labelBuf.push(line.trim()); continue; }

      // bar lines typed directly under one another
      let heads = [rowHead(line)];
      while (i + 1 < lines.length && isBarLine(lines[i + 1])) heads.push(rowHead(lines[++i]));
      const merged = mergeGraphs(heads);
      if (merged) heads = merged;
      const first = heads[heads.length - 1].bl.first;

      // the annotation lines that follow: numerals, notes, and labelled note lines without bars
      const after = [], prose = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !isBarLine(lines[j])) {
        // "A Major:  vi" -> "A:  vi", keeping the columns
        const l = lines[j].replace(/^(\s*[A-Ga-g](?:#|b|-flat|-sharp)?)\s+(?:Major|major|minor):/, (m, k) => (k + ":").padEnd(m.length));
        // "A:  V-of-V (4 beats in the US, and 6 beats in the UK!)": numerals, then a remark
        const sp = /^(.*?\S)\s+(\([^)]*[a-z]{3,}[^)]*\)?.*)$/.exec(l);
        if (sp && sp[2].length > 12 && isNumeralLine(sp[1], first)) { after.push({ l: sp[1], numeral: true }); prose.push(sp[2].trim()); j++; continue; }
        const numeral = isNumeralLine(l, first);
        const nextBar = j + 1 < lines.length && isBarLine(lines[j + 1]);
        if (!numeral && nextBar && after.length) break;          // probably a label for the next system
        if (!numeral && tokens(l).length > 8 && !isPitchLine(l, first)) break;  // prose, not an annotation
        after.push({ l, numeral });
        j++;
      }
      i = j - 1;

      heads.forEach((h) => { if (h.caption) labelBuf.push(h.caption); });
      // a label broken over two lines: "Bass-" / "line: |..."
      if (heads[0].label && labelBuf.length && /^[A-Za-z]+-$/.test(labelBuf[labelBuf.length - 1])) {
        heads[0].label = labelBuf.pop() + heads[0].label;
        heads[0].role = rowRole(heads[0].label);
      }
      // rows typed one above another sound together (a tune over its chords, voices, words over the music)
      let rows;
      const labelled = heads.some((h) => h.label);
      if (heads.length > 1 && !labelled && prevMulti && prevMulti.length === heads.length && prevMulti.some((r) => r.role === "chords")) {
        heads.forEach((h, n) => { h.role = prevMulti[n].label ? rowRole(prevMulti[n].label) : prevMulti[n].role; h.label = prevMulti[n].label; h.inherited = true; });
      }
      if (heads.length > 1) { inferRoles(heads); rows = [heads]; }
      else rows = heads.map((h) => [h]);

      rows.forEach((group, gi) => {
        const lastGroup = gi === rows.length - 1;
        const sysRows = group.map((h) => {
          if (h.key) key = key || h.key;
          let role = h.role || "chords";
          if (role === "voice" && !isPitchLine(h.line, h.bl.first)) role = "other";
          if (role === "other") h.line = h.raw || h.line;
          const segs = segments(h.line, h.bl);
          let r = readBars(h.line, segs, role);
          const pk = h.pickup ? readBars(h.line, [h.pickup], role).bars[0] : null;
          // each note at the height of its line in the graph (the notes of a run, the nearest octave to it)
          if (h.graphMidi) r.bars.forEach((b) => b.beats.forEach((bt) => {
            if (bt.pitch === undefined) return;
            let c = bt.c;
            while (c > 0 && h.graphMidi[c] === undefined) c--;
            const at = h.graphMidi[c];
            if (at === undefined) return;
            let m = at + ((((bt.pitch - at) % 12) + 12) % 12);
            if (m - at > 6) m -= 12;
            bt.midi = m;
          }));
          return { label: h.label, role, r, segs, line: h.line, raw: h.raw, bl: h.bl, explicit: !!h.label, pickup: pk, voiceIndex: h.voiceIndex, pkHead: h.pickup, contour: !!h.graphMidi };
        });
        // a line whose bars are empty and whose words come after them ("||3rd refrain, only") is a caption
        for (let k = sysRows.length - 1; k >= 0 && sysRows.length > 1; k--) {
          const row = sysRows[k], src = row.raw || row.line;
          const tail = src.slice(src.lastIndexOf("|") + 1).trim();
          const blank = row.r.bars.every((bt) => bt.beats.every((x) => !(x.text || "").trim() && !x.chord && x.pitch === undefined));
          if (!row.explicit && blank && /[a-z]{3}/i.test(tail)) { labelBuf.push(tail); sysRows.splice(k, 1); }
        }
        const myAfter = lastGroup ? after : [];
        const hasNumerals = myAfter.some((a) => a.numeral);
        // a lone unlabelled row is only chords if it reads as chords
        sysRows.forEach((row) => {
          if (row.role !== "chords") return;
          const r = row.r;
          const avg = r.n / Math.max(1, r.bars.length);
          const mostlyChords = r.ok > 0 && r.bad <= Math.max(1, Math.floor(r.ok / 3));
          const strict = !row.explicit && sysRows.length === 1;
          if (!mostlyChords || (strict && ((r.bad > 0 && !hasNumerals) || (!hasNumerals && avg > 2.5)))) {
            row.role = "other"; row.r = readBars(row.raw || row.line, row.segs, "other");
          }
        });
        // a row of nothing but holds and dashes is not music
        sysRows.forEach((row) => {
          if (row.role === "other") return;
          const sounding = row.r.bars.some((b) => b.beats.some((bt) => bt.chord || bt.pitch !== undefined));
          // ... except a row of holds that carries on the chord before it
          const carries = row.role === "chords" && systems.some((x) => x.rows.some((r) => r.role === "chords"));
          if (!sounding && !carries) { row.role = "other"; row.r = readBars(row.raw || row.line, row.segs, "other"); }
        });
        const driver = ["chords", "bass", "voice"].map((rl) => sysRows.findIndex((r) => r.role === rl)).find((x) => x >= 0);
        const drv = sysRows[driver === undefined ? 0 : driver];

        // annotation lines: a labelled (or, by analogy, unlabelled) line of note names becomes a row
        myAfter.forEach((a, idx) => {
          const lab = ROW_LABEL_RE.exec(a.l);
          const labRole = lab && a.l.indexOf(lab[0]) + lab[0].length <= first + 1 ? rowRole(lab[1]) : null;
          const prevVirtual = systems.length && systems[systems.length - 1].virtual;
          if (!a.numeral && isPitchLine(a.l, first) && ((labRole === "bass" || labRole === "voice") || (!lab && prevVirtual))) {
            const role = labRole || prevVirtual.role;
            const label = lab ? lab[1].trim() : prevVirtual.label;
            const r = readBars(a.l, drv.segs, role);
            sysRows.push({ label, role, r, segs: drv.segs, line: a.l, bl: drv.bl, virtual: true });
            a.used = true;
            return;
          }
          const kk = /^\s*([A-Ga-g](?:#|b|-flat|-sharp)?)\s*:/.exec(a.l);
          if (kk && a.l.indexOf(":") <= first + 1 && idx === 0) key = key || kk[1];
          const firstNumeral = myAfter.findIndex((x) => x.numeral && !x.used);
          attach(drv.r.bars, a.l, a.numeral ? (myAfter.indexOf(a) === firstNumeral ? "rn" : "rn2") : "note", first);
        });
        const label = labelBuf.filter((x) => !/^[-\s]*$/.test(x)).map((x) => x.replace(/\*\*/g, "").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim()).join(" / ") || null;
        labelBuf = [];
        const out = {
          label: sysRows.length === 1 && sysRows[0].label && sysRows[0].role === "other" ? [label, sysRows[0].label].filter(Boolean).join(" — ") : label,
          rows: sysRows.map((r) => ({ label: r.label, role: r.role, bars: r.r.bars, virtual: !!r.virtual, pickup: r.pickup, voiceIndex: r.voiceIndex, contour: r.contour })),
          driver: (() => { const d = ["chords", "bass", "voice"].map((rl) => sysRows.findIndex((r) => r.role === rl)).find((x) => x >= 0); return d === undefined ? 0 : d; })(),
          note: lastGroup && prose.length ? prose.join(" ") : null,
        };
        out.rows.forEach((r) => { r.register = registerOf(r); });
        // a tune over chords sits above them (the chords keep to about MIDI 56-68)
        const firstChords = out.rows.findIndex((r) => r.role === "chords");
        out.rows.forEach((r, n) => { if (r.role === "voice" && n < firstChords) r.register = Math.max(r.register, 72); });
        out.pickup = out.rows.some((r) => r.pickup);
        const virt = out.rows.find((r) => r.virtual);
        if (virt) out.virtual = { role: virt.role, label: virt.label };
        if (sysRows.length > 1 && !virt) prevMulti = sysRows;
        systems.push(out);
      });
    }
    if (labelBuf.length && systems.length) systems[systems.length - 1].after = labelBuf.join(" ");
    systems.forEach((s) => {
      s.playable = s.rows[s.driver] && s.rows[s.driver].role !== "other";
      // a system lasts as long as its longest playable row
      s.length = s.playable ? Math.max(...s.rows.filter((r) => r.role !== "other").map((r) => r.bars.length)) : 0;
    });
    // A chart is worth drawing if most of its systems can be read as music
    const good = systems.filter((s) => s.playable).length;
    const chords = systems.some((s) => s.rows.some((r) => r.role === "chords"));
    const ok = good > 0 && systems.length - good <= good && (chords || systems.every((s) => s.playable));
    return { ok, key, systems };
  }

  // ------------------------------------------------------------------ pretty printing
  function prettyChord(t) {
    let s = t.replace(/-flat/g, "♭").replace(/-sharp/g, "♯").replace(/-nat(?:ural)?\.?/g, "♮").replace(/^([A-Ga-g])b/, "$1♭").replace(/#/g, "♯");
    const m = /^(\(?[A-Ga-g][♭♯]?)(.*?)(\)?)$/.exec(s);
    if (!m) return escapeHtml(s);
    let q = m[2].replace(/^-/, "").replace(/-?diminished/i, "dim").replace(/-?augmented/i, "aug").replace(/half-dim\.?(7?)/, "ø$1").replace(/dim\.?7/, "°7").replace(/dim\.?|^o$/, "°").replace(/half-dim/, "ø").replace(/aug\.?/, "+");
    return escapeHtml(m[1]) + (q ? "<sup>" + escapeHtml(q) + "</sup>" : "") + escapeHtml(m[3]);
  }
  function prettyNumeral(t) {
    return escapeHtml(t.replace(/^flat-/, "♭").replace(/^sharp-/, "♯").replace(/-flat/g, "♭").replace(/-dim7?/g, (x) => x.endsWith("7") ? "°7" : "°").replace(/-of-/g, " of "));
  }
  const prettyNote = (t) => escapeHtml(t.replace(/-flat/, "♭").replace(/-sharp/, "♯").replace(/-nat(ural)?/, "♮").replace(/^([A-Ga-g])b$/, "$1♭").replace(/#/, "♯").replace(/^([a-g])/, (c) => c.toUpperCase()));
  const prettyKey = (k) => k.replace(/-flat/, "♭").replace(/-sharp/, "♯").replace(/^([A-Ga-g])b$/, "$1♭").replace(/#/, "♯");
  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

  // ------------------------------------------------------------------ transcriptions
  // A chart written out by hand in data/charts/<figure>.chart (format in data/charts/README.md):
  // read it into the same model the automatic reader makes, with each event's time spelled out.
  const NOTE_RE = /^([A-Ga-g])(##|bb|#|b|n)?(-?\d)$/;
  const ACC = { "#": 1, "##": 2, b: -1, bb: -2, n: 0, "": 0 };
  const ACC_TEXT = { "#": "#", "##": "##", b: "-flat", bb: "bb", n: "-nat", "": "" };

  function parseScore(text, beatsPerBar) {
    const model = { systems: [], key: null, meter: null, explicit: true, doubts: [] };
    let bpb = beatsPerBar, sys = null;
    const meterBeats = (m) => {
      const [n, d] = m.split("/").map(Number);
      return d === 8 && n % 3 === 0 && n > 3 ? n / 3 : n;
    };
    // one event: name{numeral}*beats, in either order
    const event = (tok, role, prev) => {
      const m = /^([^{*]*)(?:\{([^}]*)\})?(?:\*([\d.\/]+))?(?:\{([^}]*)\})?$/.exec(tok);
      if (!m) return { text: tok, word: true };
      const [, name, rn1, dur, rn2] = m;
      const b = {};
      if (rn1 || rn2) b.rn = rn1 || rn2;
      if (dur) b.dur = dur.includes("/") ? dur.split("/").reduce((a, c) => a / c) : +dur;
      if (name === "-" || name === "") Object.assign(b, { hold: true, text: "–" });
      else if (name === "r") Object.assign(b, { rest: true, text: "" });
      else if (role === "words") Object.assign(b, { text: name.replace(/_/g, " "), word: true });
      else if (role === "chords") {
        const ch = parseChord(name, prev.chord);
        if (ch) { Object.assign(b, { chord: ch, text: ch.text }); prev.chord = ch; } else Object.assign(b, { text: name, word: true });
      } else {
        const notes = name.split("+").map((n) => NOTE_RE.exec(n));
        if (notes.every(Boolean)) {
          const midis = notes.map(([, l, a = "", o]) => 12 * (+o + 1) + PC[l.toLowerCase()] + ACC[a]);
          Object.assign(b, {
            midi: Math.max(...midis), pitch: ((Math.max(...midis) % 12) + 12) % 12,
            text: notes.map(([, l, a = ""]) => l.toUpperCase() + ACC_TEXT[a]).join("+"),
          });
          if (midis.length > 1) { b.midis = midis; b.texts = b.text.split("+"); }
        } else Object.assign(b, { text: name, word: true });
      }
      return b;
    };
    // the events of one bar, each given its start ("at") and length in beats
    const bar = (src, role, prev, len) => {
      // "[5]" at the start of a bar: a measure number or count, printed small above the bar
      // "<3>": this bar is 3 beats long (a 3/4 bar in a 4/4 song); with a mark, either order
      let mark = null;
      for (let k = 0; k < 2; k++) {
        src = src.replace(/^\s*\[([^\]]*)\]/, (x, t) => { mark = t; return ""; });
        src = src.replace(/^\s*<([\d.]+)>/, (x, n) => { if (len !== null) len = +n; return ""; });
      }
      const toks = src.match(/[^\s{]*(?:\{[^}]*\})?[^\s{]*(?:\{[^}]*\})?/g).filter((t) => t.trim());
      const beats = toks.map((t) => event(t, role, prev));
      const fixed = beats.reduce((a, b) => a + (b.dur || 0), 0), free = beats.filter((b) => !b.dur).length;
      const share = len === null ? 1 : free ? Math.max(0, len - fixed) / free : 0;
      let at = 0;
      beats.forEach((b) => { b.at = at; b.dur = b.dur || share; at += b.dur; });
      return { beats, len: len === null ? at : len, mark };
    };
    text.split("\n").forEach((raw) => {
      if (/^\s*#\?/.test(raw)) { model.doubts.push(raw.replace(/^\s*#\?\s*/, "")); return; }
      const line = raw.replace(/(^|\s)#(\s.*)?$/, "").trim();
      if (!line) return;
      let m;
      if ((m = /^skip\b\s*(.*)$/.exec(line))) { model.skip = m[1] || true; return; }
      if ((m = /^meter\s+(\d+\/\d+)/.exec(line))) { model.meter = m[1]; bpb = meterBeats(m[1]); return; }
      if ((m = /^key\s+(\S+)/.exec(line))) { model.key = m[1]; return; }
      if ((m = /^system\b\s*(.*)$/.exec(line))) { sys = { label: m[1] || null, rows: [], note: null }; model.systems.push(sys); return; }
      if ((m = /^caption\s+(.*)$/.exec(line))) { if (sys) sys.note = m[1]; return; }
      if ((m = /^(chords|bass|voice|words)(?:\s+"([^"]*)")?(\s+contour)?\s*(.*)$/.exec(line))) {
        if (!sys) { sys = { label: null, rows: [], note: null }; model.systems.push(sys); }
        const [, role, label, contour, rest] = m;
        const parts = rest.split("|");
        const prev = {};
        const pick = parts[0].trim() ? bar(parts[0], role, prev, null) : null;
        const bars = parts.slice(1).filter((x, i, a) => i < a.length - 1 || x.trim()).map((x) => bar(x, role, prev, bpb));
        sys.rows.push({ label: label || null, role: role === "words" ? "other" : role, contour: !!contour, bars, pickup: pick });
      }
    });
    model.systems.forEach((x) => {
      x.rows.forEach((r) => { r.register = registerOf(r); });
      x.pickup = x.rows.some((r) => r.pickup);
      x.pickupLen = x.pickup ? Math.max(...x.rows.map((r) => (r.pickup ? r.pickup.len : 0))) : 0;
      const d = ["chords", "bass", "voice"].map((rl) => x.rows.findIndex((r) => r.role === rl)).find((i) => i >= 0);
      x.driver = d === undefined ? 0 : d;
      x.playable = x.rows.some((r) => r.role !== "other");
      x.length = Math.max(0, ...x.rows.map((r) => r.bars.length));
    });
    model.bpb = bpb;
    model.ok = !model.skip && model.systems.some((x) => x.playable);
    return model;
  }

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
    let bass = 36 + chord.bass;   // C2 + pitch class, then lifted to E2-D#3: low, but high enough for small speakers
    if (bass < 40) bass += 12;
    return { notes, bass };
  }

  // Start notes at time t; they sustain until release() is called with the time the next event starts.
  // notes: [[midi, amplitude], ...]
  function strike(bus, oscs, t, notes, vel) {
    return notes.map(([m, amp]) => {
      const g = ctx.createGain();
      const a = amp * vel;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.012);
      g.gain.exponentialRampToValueAtTime(a * 0.45, t + 0.35);
      g.connect(bus);
      const os = [["triangle", 0], ["sine", 4]].map(([type, cents]) => {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = midiHz(m); o.detune.value = cents;
        o.connect(g); o.start(t);
        oscs.push(o);
        return o;
      });
      // a low note's fundamental is lost on laptop and phone speakers: add its 2nd-5th harmonics (a
      // filtered sawtooth) so the ear still hears the pitch
      if (m < 57) {
        const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), sg = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = midiHz(m);
        lp.type = "lowpass"; lp.frequency.value = Math.min(1400, midiHz(m) * 5.5); lp.Q.value = 0.5;
        sg.gain.value = 1;
        o.connect(lp); lp.connect(sg); sg.connect(g); o.start(t);
        oscs.push(o); os.push(o);
      }
      return { g, os, a, t };
    });
  }

  function release(voices, t) {
    voices.forEach(({ g, os, a, t: t0 }) => {
      const at = Math.max(t, t0 + 0.02);
      // fade from wherever the note's decay has got to: cancelling the decay alone would put the note
      // back at full volume, which sounds like a second hit. Redo the decay, stopping where the fade begins.
      g.gain.cancelScheduledValues(at);
      const k = Math.min(1, Math.max(0, (at - t0 - 0.012) / 0.338));
      if (at > t0 + 0.012) g.gain.exponentialRampToValueAtTime(a * Math.pow(0.45, k), at);
      else g.gain.setValueAtTime(a, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      os.forEach((o) => { try { o.stop(at + 0.3); } catch (e) { /* already stopped */ } });
    });
  }

  function stop() {
    if (!current) return;
    clearInterval(current.tick);
    current.cleanup();
    current.timers.forEach(clearTimeout);
    current.fig.querySelectorAll(".bar.playing").forEach((b) => b.classList.remove("playing"));
    current.btn.setAttribute("aria-pressed", "false");
    current.btn.setAttribute("aria-label", "Play this progression");
    current.btn.innerHTML = PLAY_ICON;
    // fade this performance's bus out, then cancel every oscillator it started
    const { bus, oscs } = current;
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + 0.04);
    oscs.forEach((o) => { try { o.stop(now + 0.05); } catch (e) { /* already stopped */ } });
    setTimeout(() => { try { bus.disconnect(); } catch (e) { /* ignore */ } }, 120);
    current = null;
  }

  // Turn the parsed chart into a timeline measured in beats. Each playable row of a system is a track;
  // the system's driving row (chords, else bass, else the first voice) sets how many bars it lasts.
  function timeline(model, beatsPerBar) {
    const events = [];   // { beat, slot } to light a bar, or { beat, track, kind, chord|pitch }
    let beat = 0, slot = 0;
    // one track per part (the chords, the bass, each voice from the top), carried from system to system
    const trackOf = (sys, row) => row.role === "chords" ? "c" : row.role === "bass" ? "b" : "v" + sys.rows.filter((r) => r.role === "voice").indexOf(row);

    // the events of one row's bar, laid over `len` beats from `start`
    function barEvents(sys, row, ri, bar, start, len, hasBass, voices) {
      // the notes and chords in a bar share it equally (Pollack's spacing is too loose to read rhythm from)
      const evs = bar.beats.filter((b) => b.chord || b.pitch !== undefined || b.rest || b.hold || b.empty);
      // (a transcription spells out each event's time)
      evs.forEach((b, n) => (evs[n] = { b, at: b.at !== undefined ? b.at : (n * len) / evs.length }));
      if (row.role === "chords" && (!evs.length || evs[0].at > 0)) evs.unshift({ b: { hold: true }, at: 0 });
      // a note line falls silent at the bar line unless the bar begins with a hold ("-")
      if (row.role !== "chords" && !(evs.length && evs[0].at === 0)) evs.unshift({ b: { rest: true }, at: 0 });
      evs.forEach((e) => {
        const b = e.b;
        const ev = { beat: start + e.at, track: b.riff ? "r" : trackOf(sys, row), role: b.riff ? "voice" : row.role, register: b.riff ? 64 : row.register };
        if (b.chord) Object.assign(ev, { kind: "chord", chord: b.chord, noBass: hasBass, soft: voices > 0 });
        else if (b.pitch !== undefined) Object.assign(ev, { kind: "note", pitch: b.pitch, midi: b.midi, midis: b.midis });
        else if (b.rest) ev.kind = "rest";
        else if (row.role === "chords") Object.assign(ev, { kind: "hold", noBass: hasBass, soft: voices > 0 });
        else return;  // a held note simply keeps sounding
        events.push(ev);
      });
    }

    const heard = new Set();   // tracks that have sounded so far
    model.systems.forEach((sys) => {
      if (!sys.playable) return;
      // a part this system doesn't write out falls silent, so a bass line's last note doesn't ring on under the next chords
      const here = new Set(sys.rows.filter((r) => r.role !== "other").map((r) => trackOf(sys, r)));
      heard.forEach((tr) => { if (!here.has(tr)) { events.push({ beat, track: tr, kind: "rest" }); heard.delete(tr); } });
      here.forEach((tr) => heard.add(tr));
      const hasBass = sys.rows.some((r) => r.role === "bass");
      const voices = sys.rows.filter((r) => r.role === "voice").length;
      if (sys.pickup) {
        // a pickup lasts as many beats as it has notes or chords (up to a bar less one)
        const n = Math.max(...sys.rows.map((r) => (r.pickup ? r.pickup.beats.filter((b) => b.chord || b.pitch !== undefined).length : 0)));
        const len = sys.pickupLen || Math.max(1, Math.min(beatsPerBar - 1, n));
        events.push({ beat, slot: slot++ });
        sys.rows.forEach((row, ri) => { if (row.pickup && row.role !== "other") barEvents(sys, row, ri, row.pickup, beat, len, hasBass, voices); });
        beat += len;
      }
      for (let i = 0; i < sys.length; i++) {
        // a transcribed bar may have its own length ("<3>")
        const barLen = Math.max(0, ...sys.rows.map((r) => (r.bars[i] && r.bars[i].len) || 0)) || beatsPerBar;
        events.push({ beat, slot: slot++ });
        sys.rows.forEach((row, ri) => {
          if (row.role === "other") return;
          const bar = row.bars[i];
          if (!bar) { if (row.role !== "chords") events.push({ beat, track: trackOf(sys, row), kind: "rest" }); return; }
          barEvents(sys, row, ri, bar, beat, barLen, hasBass, voices);
        });
        beat += barLen;
      }
    });
    events.sort((a, b) => a.beat - b.beat || (a.slot !== undefined ? -1 : 0) - (b.slot !== undefined ? -1 : 0));
    return { events, total: beat };
  }

  function play(fig, model, btn, slider, beatsPerBar, from) {
    if (current && current.fig === fig && from === undefined) { stop(); return; }
    stop();
    audio();
    const { events, total } = timeline(model, beatsPerBar);
    const bus = ctx.createGain();
    bus.connect(master);
    const oscs = [], timers = [];
    // tempo can change at any moment: keep an anchor (beat, time) and the current seconds-per-beat
    let spb = 60 / +slider.value;
    // starting from a bar part-way through: begin at that bar's slot event
    let next = from ? Math.max(0, events.findIndex((e) => e.slot === from)) : 0;
    let anchorBeat = next ? events[next].beat : 0, anchorTime = ctx.currentTime + 0.08;
    const timeOf = (b) => anchorTime + (b - anchorBeat) * spb;
    let finished = false;
    const tracks = {};   // track -> { sounding, last chord, voicing, midi }

    // what one event sounds, as [[midi, gain], …] and a velocity; keeps each track's chord, voicing and last note
    const sound = (ev, tr) => {
      if (ev.kind === "chord" || ev.kind === "hold") {
        const chord = ev.chord || tr.last;
        if (!chord) return null;
        if (ev.chord) tr.voicing = voice(chord, tr.voicing && tr.voicing.notes);
        else tr.voicing = tr.voicing || voice(chord, null);
        const notes = tr.voicing.notes.map((m) => [m, 0.16]);
        if (!ev.noBass) notes.push([tr.voicing.bass, 0.26]);
        tr.last = chord;
        return { notes, vel: (ev.chord ? (chord.implied ? 0.55 : 1) : 0.5) * (ev.soft ? 0.7 : 1) };
      }
      // the octave closest to the previous note of this line, leaning toward the line's register so
      // a run of fourths doesn't carry it off the keyboard
      const ref = tr.midi || ev.register;
      const pc = ((ev.pitch % 12) + 12) % 12;
      let m = ev.midi;   // set when the chart shows the octave
      if (m === undefined) {
        let best = Infinity;
        for (let c = pc + 24; c <= 96; c += 12) {
          const cost = Math.abs(c - ref) + 0.5 * Math.abs(c - ev.register);
          if (cost < best) { best = cost; m = c; }
        }
      }
      tr.midi = m;
      const amp = ev.role === "bass" ? 0.28 : ev.register >= 66 ? 0.24 : 0.17;
      return { notes: (ev.midis || [m]).map((x) => [x, ev.midis ? amp * 0.8 : amp]), vel: 1 };
    };
    // run silently through the bars before the start, then sound whatever is still held there
    const held = {};
    for (let k = 0; k < next; k++) {
      const ev = events[k];
      if (ev.slot !== undefined) continue;
      const tr = tracks[ev.track] || (tracks[ev.track] = {});
      held[ev.track] = ev.kind === "rest" ? null : sound(ev, tr) || held[ev.track];
    }
    // (a part that starts something new on that very beat needn't sound what came before)
    const fresh = new Set(events.slice(next).filter((e) => e.track && e.beat === anchorBeat).map((e) => e.track));
    Object.entries(held).forEach(([k, h]) => { if (h && !fresh.has(k)) tracks[k].sounding = strike(bus, oscs, anchorTime, h.notes, h.vel * 0.8); });

    const tick = () => {
      const horizon = ctx.currentTime + 0.15;
      while (next < events.length && timeOf(events[next].beat) < horizon) {
        const ev = events[next++];
        const t = Math.max(timeOf(ev.beat), ctx.currentTime);
        if (ev.slot !== undefined) {
          const sl = ev.slot;
          timers.push(setTimeout(() => {
            fig.querySelectorAll(".bar.playing").forEach((x) => x.classList.remove("playing"));
            fig.querySelectorAll(`.bar[data-slot="${sl}"]`).forEach((x) => x.classList.add("playing"));
          }, Math.max(0, (t - ctx.currentTime) * 1000)));
          continue;
        }
        const tr = tracks[ev.track] || (tracks[ev.track] = {});
        if (ev.kind === "rest") { if (tr.sounding) release(tr.sounding, t); tr.sounding = null; continue; }
        const h = sound(ev, tr);
        if (!h) continue;
        if (tr.sounding) release(tr.sounding, t);
        tr.sounding = strike(bus, oscs, t, h.notes, h.vel);
      }
      if (next >= events.length && !finished && timeOf(total) < horizon) {
        finished = true;
        const end = timeOf(total);
        Object.values(tracks).forEach((tr) => tr.sounding && release(tr.sounding, end));
        timers.push(setTimeout(() => { if (current && current.fig === fig) stop(); }, (end - ctx.currentTime) * 1000 + 350));
      }
    };
    const onTempo = () => {
      if (!current || current.fig !== fig) return;
      const now = ctx.currentTime;
      if (now > anchorTime) { anchorBeat += (now - anchorTime) / spb; anchorTime = now; }
      spb = 60 / +slider.value;
    };
    slider.addEventListener("input", onTempo);
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", "Stop");
    btn.innerHTML = STOP_ICON;
    current = { fig, btn, timers, bus, oscs, tick: setInterval(tick, 25), cleanup: () => slider.removeEventListener("input", onTempo) };
    tick();
  }

  const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z" fill="currentColor"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

  // ------------------------------------------------------------------ rendering


  // A stacked system too wide for the page breaks into pieces of whole bars, each repeating the row
  // labels; it rejoins and breaks again when the page is resized.
  // a bar that starts a line (the first, or the first after a wrap) shows the key names in its gutter
  function markLineStarts(wrap) {
    const mark = () => wrap.querySelectorAll(".bar-row.keyed").forEach((row) => {
      let top = null;
      row.querySelectorAll(".bar").forEach((b) => {
        b.classList.toggle("line-start", top === null || b.offsetTop > top + 2);
        top = b.offsetTop;
      });
    });
    mark();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => requestAnimationFrame(mark)).observe(wrap);
  }

  function fitSystems(wrap) {
    const items = [...wrap.querySelectorAll(".bar-system.stacked")].map((box) => ({ box, n: box.style.getPropertyValue("--n"), parts: [] }));
    if (!items.length) return;
    const cellsOf = (row) => [...row.children].filter((c) => !c.classList.contains("row-label"));
    const fit = () => {
      items.forEach((it) => {
        if (it.parts.length) {   // put the bars back in the whole system first
          const rows = [...it.box.children];
          it.parts.forEach((part) => [...part.children].forEach((r, ri) => cellsOf(r).forEach((c) => rows[ri].appendChild(c))));
          it.parts[0].before(it.box);
          it.parts.forEach((part) => part.remove());
          it.parts = [];
          it.box.style.setProperty("--n", it.n);
        }
        const avail = wrap.clientWidth;
        if (!avail || it.box.scrollWidth <= avail + 1) return;   // (not laid out yet: wait for a resize)
        const rows = [...it.box.children];
        const label = rows[0].querySelector(".row-label");
        const room = avail - (label ? label.getBoundingClientRect().width : 0) - 4;
        const widths = cellsOf(rows[0]).map((c) => c.getBoundingClientRect().width);
        const groups = [];
        let cur = [], used = 0;
        widths.forEach((w, i) => {
          if (cur.length && used + w > room) { groups.push(cur); cur = []; used = 0; }
          cur.push(i); used += w;
        });
        if (cur.length) groups.push(cur);
        if (groups.length < 2) return;
        const cells = rows.map(cellsOf);
        it.parts = groups.map((g, gi) => {
          const part = it.box.cloneNode(false);
          part.classList.add("part");
          part.style.setProperty("--n", g.length);
          rows.forEach((row, ri) => {
            const r = row.cloneNode(false);
            const l = row.querySelector(".row-label");
            if (l) r.appendChild(l.cloneNode(true));
            g.forEach((i) => cells[ri][i] && r.appendChild(cells[ri][i]));
            part.appendChild(r);
          });
          return part;
        });
        it.parts.forEach((part) => it.box.before(part));
        it.box.remove();
      });
    };
    fit();
    if (typeof ResizeObserver !== "undefined") {
      let w = wrap.clientWidth, pending = false;
      new ResizeObserver(() => {
        if (wrap.clientWidth === w || pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; w = wrap.clientWidth; fit(); });
      }).observe(wrap);
    }
  }

  // numerals read in more than one key ({A: flat-VI = Bb: V}, {E: IV / c#: VI}, {i (B: ii)}) get a row
  // per key, as Pollack types them, with the key named at its first numeral in the system
  const KEYED = /^(\()?([A-Ga-g](?:#|b|-flat|-sharp)?):\s*(.*)$/;
  const sameKey = (k) => k && k.replace(/-flat/, "b").replace(/-sharp/, "#");
  function keyParts(rn, cur) {
    const m = /^(.*?\S)\s*\(([A-Ga-g](?:#|b|-flat|-sharp)?:[^)]*)\)$/.exec(rn);
    const bits = m ? [m[1], " ", m[2]] : rn.split(/(\s+[=\/]\s+|;\s+(?=\(?[A-Ga-g](?:#|b|-flat|-sharp)?:))/);
    const out = [];
    for (let i = 0; i < bits.length; i += 2) {
      const k = KEYED.exec(bits[i].trim());
      const key = k ? sameKey(k[2]) : i ? out[out.length - 1].key : cur;
      out.push({ key, text: k ? (k[1] ? k[3].replace(/\)$/, "") : k[3]) : bits[i].trim(), sep: i ? bits[i - 1] : "" });
    }
    return out;
  }
  function layoutKeys(model) {
    let cur = sameKey(model.key);
    for (const sys of model.systems) {
      const start = cur, keys = [];
      const rows = sys.rows.map((row) => {
        let c = start;
        const beats = [row.pickup, ...row.bars].filter(Boolean).flatMap((b) => b.beats);
        const parts = beats.map((bt) => {
          if (!bt.rn) return null;
          const ps = keyParts(bt.rn, c);
          // "=" (or "; G: IV") is a pivot into the next key; "/" and "( )" are second readings, the music stays put
          // (a second reading that includes the current key leaves it there)
          const piv = ps.findIndex((p, i) => i && /[=;]/.test(p.sep));
          c = piv > 0 ? ps.slice(piv).reduce((k, p, i) => (!i || /[=;]/.test(p.sep) ? p.key : k), null)
            : ps.some((p) => p.key === c) ? c : ps[0].key;
          ps.forEach((p) => { if (!keys.includes(p.key)) keys.push(p.key); });
          return ps;
        });
        if (parts.some(Boolean)) cur = c;
        return { beats, parts };
      });
      // one row in the chart's own key needs no labels: draw it as written, less any "A:" prefix
      const plain = keys.length === 1 && keys[0] === sameKey(model.key);
      if (!keys.length || (plain && !rows.some((r) => r.parts.some((ps) => ps && ps.length > 1)))) {
        if (plain) rows.forEach((r) => r.beats.forEach((bt, i) => { if (r.parts[i]) bt.rn = r.parts[i][0].text; }));
        continue;
      }
      const home = keys.indexOf(sameKey(model.key));
      if (home > 0) keys.unshift(keys.splice(home, 1)[0]);
      // the keys are named once, hanging left of the staff at the start of each line (see markLineStarts)
      sys.keys = keys.map((k) => (k ? prettyKey(k) + ":" : ""));
      rows.forEach((r) => {
        if (!r.parts.some(Boolean)) return;
        r.beats.forEach((bt, i) => {
          const lines = keys.map(() => "");
          (r.parts[i] || []).forEach((p) => {
            const j = Math.max(0, keys.indexOf(p.key));
            lines[j] += (lines[j] ? p.sep : "") + p.text;
          });
          bt.rns = lines;
        });
      });
    }
  }

  function render(fig, opts = {}) {
    const pre = fig.querySelector(".chart-src");
    if (!pre || fig.classList.contains("drawn")) return;
    const score = fig.querySelector(".chart-score");
    const model = score ? parseScore(score.textContent, opts.beatsPerBar || 4) : parse(pre.textContent);
    if (!model.ok) { fig.classList.add("undrawn"); return; }
    if (score) fig.classList.add("transcribed");
    if (score) layoutKeys(model);
    const beatsPerBar = model.meter ? model.bpb : opts.beatsPerBar || 4;
    const wrap = document.createElement("div");
    wrap.className = "bars" + (model.explicit ? " timed" : "");
    wrap.style.setProperty("--bpb", beatsPerBar);
    const key = model.key ? prettyKey(model.key) : null;
    const tempoId = "tempo-" + Math.random().toString(36).slice(2, 8);
    wrap.innerHTML =
      `<div class="bars-head"><button type="button" class="playbtn" aria-pressed="false" aria-label="Play this progression">${PLAY_ICON}</button>` +
      (key ? `<span class="bars-key">in ${escapeHtml(key)}</span>` : "") +
      `<label class="tempo" for="${tempoId}">Tempo <input id="${tempoId}" type="range" min="40" max="220" step="1" value="${opts.bpm || 120}"><output>${opts.bpm || 120} bpm</output></label>` +
      (opts.recorded ? `<span class="tempo-note" title="Measured from the Isophonics beat annotations of the record">the record’s tempo</span>` : "") + `</div>`;
    // slot numbers, so every row of a system lights up together as it plays
    let slot = 0;
    model.systems.forEach((sys) => {
      if (sys.label) { const p = document.createElement("p"); p.className = "bar-row-label"; p.textContent = sys.label; wrap.appendChild(p); }
      const nBars = Math.max(...sys.rows.map((r) => r.bars.length));
      const drvBars = sys.length;
      const showLabels = sys.rows.some((r) => r.label && !(sys.rows.length === 1 && r.role === "other"));
      const box = document.createElement("div");
      box.className = "bar-system" + (sys.rows.length > 1 || showLabels ? " stacked" : "");
      if (sys.rows.length > 1 || showLabels) box.style.setProperty("--n", nBars + (sys.pickup ? 1 : 0));
      sys.rows.forEach((row) => {
        const r = document.createElement("div");
        r.className = "bar-row role-" + row.role;
        const keyed = sys.keys && row.bars.some((b) => b && b.beats.some((bt) => bt.rns));
        if (keyed) r.classList.add("keyed");
        if (showLabels) {
          const l = document.createElement("span");
          l.className = "row-label"; l.textContent = row.label || "";
          r.appendChild(l);
        }
        // a tune drawn as a graph keeps its shape: each note set lower by how far it is below the top
        const mids = row.contour ? row.bars.flatMap((b) => b.beats.map((x) => x.midi)).filter((x) => x !== undefined) : [];
        const top = mids.length ? Math.max(...mids) : null;
        let lastMidi = top;
        const drop = (bt) => {
          if (top === null) return "";
          if (bt.midi !== undefined) lastMidi = bt.midi;
          return ` style="padding-top:${((top - lastMidi) * 0.3).toFixed(2)}em"`;
        };
        const cells = (sys.pickup ? [row.pickup || null] : []).concat(Array.from({ length: sys.rows.length > 1 ? nBars : row.bars.length }, (_, i) => row.bars[i] || null));
        for (let i = 0; i < cells.length; i++) {
          const real = cells[i];
          const bar = real || { beats: [] };
          const b = document.createElement("div");
          b.className = "bar" + (real ? "" : " pad") + (sys.pickup && i === 0 ? " pickup" : "") + (real && real.mark ? " marked" : "");
          if (real && real.mark) b.dataset.mark = real.mark;
          if (sys.playable && i < drvBars + (sys.pickup ? 1 : 0)) b.dataset.slot = slot + i;
          // an empty bar holds the chord in a chord row; in a line of notes it is silence
          b.innerHTML = (bar.beats.length ? bar.beats : [{ hold: row.role === "chords", empty: row.role !== "chords", text: "" }]).map((bt) => {
            const ch = bt.chord ? prettyChord(bt.text) : bt.hold ? (real ? "–" : "") : bt.texts ? bt.texts.slice().reverse().map(prettyNote).join("<br>")
              : bt.pitch !== undefined ? prettyNote(bt.text) : escapeHtml(bt.text || "");
            const cls = bt.hold || bt.empty ? "ch hold" : bt.word ? "ch word" : bt.pitch !== undefined || bt.rest ? "ch note" : "ch";
            const grow = model.explicit && bt.dur ? `--d:${+bt.dur.toFixed(3)};` : "";
            const st = drop(bt).replace(/^ style="|"$/g, "");
            return `<span class="beat"${grow || st ? ` style="${grow}${st}"` : ""}><span class="${cls}">${ch || "&nbsp;"}${bt.fig ? `<sup class="fig">${escapeHtml(bt.fig)}</sup>` : ""}</span>` + (bt.rns ? bt.rns.map((t) => `<span class="rn">${prettyNumeral(t)}</span>`).join("") : `<span class="rn">${bt.rn ? prettyNumeral(bt.rn) : ""}</span>`) +
              (bt.rn2 ? `<span class="rn rn2">${prettyNumeral(bt.rn2)}</span>` : "") +
              (bt.note ? `<span class="bnote">${escapeHtml(bt.note)}</span>` : "") + `</span>`;
          }).join("");
          if (keyed) b.insertAdjacentHTML("afterbegin", `<span class="keys" aria-hidden="true"><span class="ch">&nbsp;</span>${sys.keys.map((k) => `<span class="rn">${escapeHtml(k)}</span>`).join("")}</span>`);
          r.appendChild(b);
        }
        box.appendChild(r);
      });
      wrap.appendChild(box);
      if (sys.playable) slot += drvBars + (sys.pickup ? 1 : 0);
      if (sys.note) { const p = document.createElement("p"); p.className = "bar-row-label after"; p.textContent = sys.note; wrap.appendChild(p); }
      if (sys.after) { const p = document.createElement("p"); p.className = "bar-row-label after"; p.textContent = sys.after; wrap.appendChild(p); }
    });
    fig.insertBefore(wrap, pre);
    fitSystems(wrap);
    if (wrap.querySelector(".bar-row.keyed")) markLineStarts(wrap);
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
    btn.addEventListener("click", () => play(fig, model, btn, slider, beatsPerBar));
    // click any bar to play from there (but not when selecting text)
    wrap.addEventListener("click", (e) => {
      const bar = e.target.closest(".bar[data-slot]");
      if (!bar || (window.getSelection && String(window.getSelection()))) return;
      play(fig, model, btn, slider, beatsPerBar, +bar.dataset.slot);
    });
    wrap.querySelectorAll(".bar[data-slot]").forEach((b) => (b.title = "Play from here"));
  }

  const api = { parse, parseScore, parseChord, render, stop, timeline };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    global.PNCharts = api;
    const init = () => {
      document.querySelectorAll("figure.chart").forEach((f) => {
        const host = f.closest("[data-bpm]") || f.closest("[data-meter]") || document.querySelector("article.essay") || document.body;
        const meterHost = f.closest("[data-meter]") || host;
        const m = /^(\d+)\/(\d+)/.exec(meterHost.dataset.meter || "");
        let beats = host.dataset.bpb ? +host.dataset.bpb : m ? +m[1] : 4;
        if (!host.dataset.bpb && m && m[2] === "8" && beats % 3 === 0) beats = beats / 3;  // compound meters: count the big beats
        if (beats < 2 || beats > 7) beats = 4;
        const bpm = host.dataset.bpm ? +host.dataset.bpm : null;
        render(f, { beatsPerBar: beats, bpm: bpm || 120, recorded: !!bpm });
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") stop(); });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
