// Check hand transcriptions in data/charts/ and show how each one reads.
//
//   node tools/check_charts.js            every .chart file
//   node tools/check_charts.js 121.1 78.1 just these figures
//
// Reports rows with different numbers of bars, bars whose events run past the bar, tokens that
// aren't notes or chords, and the "#?" doubts. Prints each system as the player will hear it:
// every event with its start beat (and octave, for notes).
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "site/static/js/charts.js"));
const dir = path.join(ROOT, "data/charts");
const essays = path.join(ROOT, "content/essays");

// the meter of the note a figure belongs to, as beats per bar (as the page counts them)
function beatsFor(id) {
  for (const f of fs.readdirSync(essays)) {
    const s = fs.readFileSync(path.join(essays, f), "utf8");
    if (!s.includes("```figure " + id + "\n")) continue;
    const m = /^meter = "(\d+)\/(\d+)/m.exec(s);
    if (!m) return { beats: 4, file: f };
    let beats = +m[1];
    if (m[2] === "8" && beats % 3 === 0) beats /= 3;
    return { beats, file: f };
  }
  return { beats: 4, file: null };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((f) => f.endsWith(".chart")).map((f) => f.slice(0, -6)).sort();
let problems = 0;
for (const id of ids) {
  const file = path.join(dir, id + ".chart");
  if (!fs.existsSync(file)) { console.log(`${id}: no file`); problems++; continue; }
  const { beats, file: essay } = beatsFor(id);
  const m = C.parseScore(fs.readFileSync(file, "utf8"), beats);
  const bpb = m.meter ? m.bpb : beats;
  console.log(`\n== ${id}  (${essay || "figure not found in essays"}, ${bpb} beats a bar${m.key ? ", key " + m.key : ""})`);
  if (m.skip) { console.log(`   skip: ${m.skip}`); continue; }
  const issues = [];
  m.systems.forEach((s, si) => {
    const counts = s.rows.map((r) => r.bars.length);
    if (new Set(counts).size > 1) issues.push(`system ${si + 1}: rows have ${counts.join("/")} bars`);
    s.rows.forEach((r) => {
      r.bars.forEach((b, bi) => {
        const end = Math.max(0, ...b.beats.map((x) => x.at + x.dur));
        if (end > (b.len || bpb) + 1e-6) issues.push(`system ${si + 1}, ${r.label || r.role}, bar ${bi + 1}: events last ${end} beats`);
        b.beats.forEach((x) => { if (x.word && r.role !== "other") issues.push(`system ${si + 1}, ${r.label || r.role}, bar ${bi + 1}: can't read "${x.text}"`); });
      });
    });
    if (s.label) console.log(`   [${s.label}]`);
    s.rows.forEach((r) => {
      const fmt = (b) => b.beats.map((x) => `${x.text || "r"}@${+x.at.toFixed(2)}${x.midis ? "(" + x.midis.join("+") + ")" : x.midi !== undefined ? "(" + x.midi + ")" : ""}${x.rn ? "{" + x.rn + "}" : ""}`).join(" ");
      console.log(`   ${(r.label || r.role).padEnd(12)} ${r.pickup ? fmt(r.pickup) + " " : ""}| ${r.bars.map(fmt).join(" | ")} |`);
    });
    if (s.note) console.log(`   (caption: ${s.note})`);
  });
  if (!m.ok) issues.push("nothing playable");
  issues.forEach((x) => console.log("   PROBLEM " + x));
  m.doubts.forEach((x) => console.log("   doubt: " + x));
  problems += issues.length;
}
console.log(problems ? `\n${problems} problem(s)` : "\nno problems");
process.exitCode = problems ? 1 : 0;
