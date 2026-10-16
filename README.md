# Notes on … every Beatles song

A re-set, navigable edition of Alan W. Pollack's *Notes on …* series (1989–2001): 200 musicological
analyses of the Beatles' songs, plus the indexes and essays from the *Soundscapes* site that hosted them.

```
make            # build dist/ (needs uv; it fetches Python deps itself)
make serve      # build and serve on http://localhost:8000
make import     # re-run the one-time import from the mirror
```

`dist/` is plain static HTML with relative links. Open `dist/index.html` straight from disk, or upload
the folder to any static host (Netlify, Cloudflare Pages, GitHub Pages, S3…). Set `base_url` in
`site/site.toml` before deploying so canonical links are right.

## Layout: content and form are separate

```
content/            WHAT — the text, editable by hand
  essays/*.md         Pollack's current notes (Markdown + TOML front matter: key, meter, form, dates…)
  originals/*.md      earlier versions of 40 notes, linked from each note's revision history
  pages/*.md          prose by others: Tillekens' "A Beatles' Odyssey", Hammond's interview
  img/                album covers and illustrations
data/               WHAT — structured indexes (JSON)
  series.json         Pollack's numbering, Tillekens' five categories
  canon.json          the 212-song canon, release by release (Tillekens)
  projects.json       twelve recording projects (Eerola)
  alphabet.json       alphabetical index with MacDonald numbers
  glossary.json       definitions written for this edition
  tempo.json          record tempos from the Isophonics beat annotations (tools/import_tempo.py)
  beatlesdb.json      main writer, lead vocal, length, Billboard rank, Wikipedia link per song,
                      from the Beatles DB (tools/import_beatlesdb.py)
site/               HOW — presentation only
  site.toml           title, base URL
  templates/*.html    Jinja templates
  static/css/site.css one stylesheet: tokens, themes, reading settings
  static/js/          site.js (settings, search, keys), charts.js (chart parser + synth),
                      essay.js, home.js, songs.js, lists.js
build.py            content + data + site -> dist/
tools/import_mirror.py   one-time importer from the mirror (read-only source)
```

### Content conventions

- Front matter is TOML between `+++` lines. Each essay has one or more `[[parts]]` (covers pages and
  double-song notes have several), each with an optional `[parts.meta]` block.
- `::: part <id>` lines in the body mark where each part begins. The id is its URL anchor.
- Pollack's ASCII chord charts are fenced as ```` ```figure 5.2 ````, kept exactly as typed. The
  browser redraws them as bars and makes them playable only when it can read them with confidence
  (about 600 of 770). The rest stay as typed.
- Links between notes are relative Markdown links (`aml.md#q1`, `../originals/sly.0.md`), so the content
  also reads correctly on GitHub. `site:songs` style links point at generated index pages.

## Features

- Full-text search over every note (`/` or ⌘K), with matches highlighted on the page you open.
- Chord charts as bars, with Web Audio playback starting at the record's tempo (measured from the
  Isophonics beat annotations for the 12 studio albums; 120 bpm elsewhere), a tempo slider, and the typed version a click away.
- A form strip for each song, linked to the section walkthrough.
- The canon as a grid on the home page, coloured by key, by who wrote it, by who sings, by year
  written or by what you've read (with a confirmed "clear").
- Song facts from the Beatles DB on each note (main writer, lead vocal, length, Billboard rank) with a
  Wikipedia link, plus writer, singer and "Billboard top 50" filters in the song table.
- A sortable, filterable song table with a shareable URL and a circle-of-fifths summary of keys.
- Releases with covers, the series in Pollack's order, recording projects, and a glossary with
  definitions shown in place as you read.
- Backlinks ("mentioned in"), next and previous in both series order and release order, and `[` `]` to move between them.
- Reading settings, kept in localStorage: Auto, Light, Dark or Sepia theme; Serif, Sans,
  Atkinson Hyperlegible or Courier Prime typeface; text size, line spacing, column width and
  justification; charts drawn or as typed.
- Read tracking (automatic at the end of a note, or by hand), "unread only" filtering, and a random-note link.
- Print styles, reduced-motion support, keyboard focus states, and a mobile outline drawer.

## Sources and rights

Text © 1989–2001 Alan W. Pollack. His notice allows the notes to be "reproduced, retransmitted,
redistributed and otherwise propagated at will, provided that this notice remains intact and in
place". Every page keeps it. The indexes are by Ger Tillekens and Tuomas Eerola, and the interview is by
Ian Hammond (*Soundscapes*). Imported from the local mirror in `~/Desktop/Library/Mirrors/www.icce.rug.nl`.
awpnoteson.info is another mirror of the same pages. It was used only to recover the seven Odyssey
illustrations (`content/img/Pollack0*.{JPG,GIF}`) missing from the local copy.

Fonts load from Google Fonts. To make the site fully self-contained, download the woff2 files into
`site/static/fonts/` and replace the `<link>` in `site/templates/base.html`.
