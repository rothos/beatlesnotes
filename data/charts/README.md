# Chart transcriptions

One file per figure, named by its number: `121.1.chart` is Figure 121.1. When a file exists, the page
draws and plays the chart from it; "Show as typed" still shows Pollack's original. Figures without a
file fall back to the automatic reader in `site/static/js/charts.js`.

These are readings of Pollack's typed charts, made once by reading each chart together with the essay
text around it. They spell out what the typed charts leave to the eye: which lines are separate parts,
which notes sound together, the octaves, and where in the bar each note falls.

## Format

```
# I Am the Walrus, intro
#? anything uncertain, for a person to check (lines starting "#?" are reported, never shown)
meter 4/4
key A

system
caption (4 beats in the US, and 6 beats in the UK!)
chords             | B{V-of-V}*4 | -*2 |

system
voice "Topline"    | D#5 C#5 F#5   | B4 A4 D5 |
chords "Bassline"  | B A           | G F{V-of-V} |
```

**Lines**

- `# ...` a comment. `#? ...` a doubt worth a listen. A `#` inside a note name (`C#5`) is not a comment.
- `meter 3/4` the meter, if it differs from the note's (or the note has none). Optional.
- `key A`, `key f#` the key shown above the chart (lower case for minor). Optional.
- `skip <reason>` (alone in the file) this figure is not music to draw: a form diagram, a table, prose.
  The page shows only the typed version.
- `system [label]` starts a new system: rows that sound together, drawn one above another. The label,
  if any, is shown above it ("Verse", "m. 9").
- `caption <text>` a remark shown under the current system.
- a row: `<role> ["Label"] [contour]  pickup | bar | bar | ...`

**Roles**

- `chords` chord symbols, spelled as Pollack spells them: `E`, `e` (lower case = minor), `E7`, `f#`,
  `b-flat`, `G#dim7`, `D/F#`, `Esus4`, `Aaug`, `Cmaj7`, `e-half-dim7`.
- `bass` a bass line: notes with octaves (below).
- `voice` a melody or inner line: notes with octaves.
- `words` lyrics, beat counts or other text lined up with the bars: drawn, never played. Join words
  that belong to one event with `_` (`so_how`).

The label in quotes is what the row is called on the page ("Topline", "Bassline", "Paul"). Leave it
out when Pollack doesn't name the row. `contour` draws a line of notes at heights that follow the
tune (use it where Pollack drew the tune as a graph, notes placed higher and lower on the page).

**Events** inside a bar are separated by spaces:

- a note: letter, optional accidental, octave. `C4` is middle C; `B3` is just below it. Accidentals:
  `#`, `b`, `n` (natural, drawn ♮: use it where Pollack writes "-nat"), `##`, `bb`. `F#5`, `Bb3`, `Fn4`.
- notes sounding together: join with `+`, e.g. `A3+A4`.
- a chord symbol (in `chords` rows).
- `-` holds what came before (a tied note, a held chord).
- `r` silence.
- a word (in `words` rows).

**Timing.** By default the events in a bar share it equally. Add `*n` to give an event n beats:
`C5*2 Bb4 Ab4` in 4/4 is a half note then two quarters. Events without `*n` share whatever is left
equally. Events before the first `|` are a pickup, one beat each unless marked. Every row of a system
must have the same number of bars; use `-` for a bar where a part holds, or `r` for one where it is
silent. Line rows up by meaning, not by spacing.

**Annotations.** `{...}` after an event (before or after `*n`) is a roman numeral or analysis
label drawn under it: `f{i}`, `b-flat{iv 6/5}`, `E{V7}`, `D{IV7}`.

## Transcribing

Read the typed chart with the paragraphs before and after it: Pollack usually says what the lines
are ("the bassline", "parallel tenths", "the topline"). Keep everything he wrote that can be shown,
and add only what the chart plainly implies (say so in a `#` comment when you add a note he didn't
type). Choose octaves that make musical sense for the part: melodies usually C4-G5, bass lines
E2-D3, inner voices between. When the rhythm is unclear, use equal shares and say so with `#?`.
