# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown-it-py>=3", "jinja2>=3.1"]
# ///
"""Build the static site:  content/ + data/  (what)  ×  site/  (how it looks)  ->  dist/

    uv run build.py            # build into dist/
    uv run build.py --serve    # build, then serve dist/ on http://localhost:8000

Every page links relatively, so dist/ also works straight from the filesystem.
"""
from __future__ import annotations

import html
import json
import re
import time
import shutil
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent
CONTENT, DATA, SITE, DIST = ROOT / "content", ROOT / "data", ROOT / "site", ROOT / "dist"


# =========================================================================== content loading

def read_doc(path: Path):
    text = path.read_text(encoding="utf-8")
    if text.startswith("+++"):
        _, fm, body = text.split("+++", 2)
        return tomllib.loads(fm), body.strip("\n")
    return {}, text


def load_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


# =========================================================================== music helpers

PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
SHARP_NAMES = {1: "C♯", 6: "F♯", 8: "G♯", 3: "D♯", 10: "A♯"}


# one colour per key, in circle-of-fifths order: C G D A E B F♯ D♭ A♭ E♭ B♭ F.
# A smooth spectrum around the circle of fifths in OKLCH (L 0.60, C 0.16, yellows lifted):
# rose at C, red at G, then orange, yellow, green, teal, blue, and violets back round to F.
KEY_COLORS = ["#CA4F77", "#CE505B", "#BF7004", "#C2BE22", "#029951", "#009296",
              "#0587CE", "#7E6CD9", "#9464CD", "#A75CBD", "#B656A9", "#C25191"]
# Tillekens' seven doubles: listed on their records, but not counted in the canon of 212
DOUBLES = {"007", "024", "025", "120", "186", "189", "194"}


def parse_key(s: str | None):
    """'E-flat Major (Mixolydian)' -> {pc: 3, mode: 'major', label: 'E♭ major'}"""
    if not s:
        return None
    m = re.search(r"\b([A-Ga-g])(#|-sharp|-flat|b(?=\s|$|/|\)))?(?=[\s/(,]|$|-)", s)
    if not m or s.strip().lower() in ("various", "sundry"):
        return None
    root, acc = m.group(1), m.group(2) or ""
    pc = PC[root.lower()] + (1 if acc in ("#", "-sharp") else -1 if acc in ("-flat", "b") else 0)
    pc %= 12
    after = s[m.end(): m.end() + 30].lower()
    minor = root.islower() or after.lstrip().startswith("minor") or "dorian minor" in after or "aeolian" in after[:12]
    if "major" in after[:12]:
        minor = False
    mode = "minor" if minor else "major"
    name = SHARP_NAMES.get(pc) if "#" in acc or "sharp" in acc else NAMES[pc]
    modal = next((w for w in ("Mixolydian", "Dorian", "Aeolian", "modal") if w.lower() in s.lower()), None)
    return {"pc": pc, "mode": mode, "label": f"{name} {mode}", "modal": modal, "color": KEY_COLORS[pc * 7 % 12]}


def parse_meter(s: str | None):
    if not s:
        return None
    m = re.search(r"\b(\d{1,2}/\d{1,2})\b", s)
    return m.group(1) if m else None


SECTION_TYPES = [
    ("intro", r"intro"),
    ("verse", r"verse"),
    ("refrain", r"refrain|chorus|hook"),
    ("bridge", r"bridge|middle"),
    ("solo", r"solo|break|instrumental|interlude|jam|link"),
    ("outro", r"outro|coda|ending|fade|tag"),
]


def parse_form(s: str | None):
    if not s:
        return []
    out = []
    for raw in [p.strip() for p in s.split("|") if p.strip()]:
        t = "other"
        for name, pat in SECTION_TYPES:
            if re.search(pat, raw, re.I):
                t = name
                break
        # "Verse (with complete ending)" -> label Verse, note
        m = re.match(r"^(.*?)\s*\((.*)\)\s*$", raw)
        label, note = (m.group(1), m.group(2)) if m and m.group(1) else (raw, "")
        out.append({"label": label, "note": note, "type": t})
    return out


def signoff_date(code: str | None):
    """Pollack signs off "Alan (031200#5.1)": MMDDYY, then the note number."""
    m = re.match(r"(\d\d)(\d\d)(\d\d)", code or "")
    if not m:
        return None
    mm, dd, yy = m.groups()
    return f"{'19' if int(yy) > 50 else '20'}{yy}-{mm}-{dd}"


def essay_dates(fm):
    """(first written, last revised) as ISO dates, from the revision history and the sign-off."""
    dates = sorted(r["date"] for r in fm.get("revisions", []) if r.get("date"))
    so = signoff_date(fm.get("signoff"))
    first = dates[0] if dates else so
    last = max([d for d in dates + [so] if d], default=None)
    return first, last


def release_year(info: str):
    m = re.search(r"\b(19\d\d)\b", info or "")
    return int(m.group(1)) if m else None


# =========================================================================== markdown rendering

def slugify(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "section"


class Renderer:
    """Markdown -> HTML with link rewriting, chord-chart figures, heading ids, and link tracking."""

    def __init__(self):
        self.md = MarkdownIt("commonmark", {"html": True, "typographer": True}).enable(["table", "smartquotes"])
        self.md.add_render_rule("fence", self._fence)
        self.md.add_render_rule("link_open", self._link_open)
        self.md.add_render_rule("image", self._image)
        self.md.add_render_rule("heading_open", self._heading_open)
        self.reset("")

    def reset(self, root: str, here: str = "notes"):
        self.root, self.here = root, here
        self.links: set[str] = set()
        self.toc: list[dict] = []
        self.ids: set[str] = set()

    # -- link mapping (content-relative -> site-relative)
    def map_link(self, href: str) -> str:
        if re.match(r"^[a-z]+://|^mailto:", href):
            return href
        if href.startswith("site:"):
            page, _, frag = href[5:].partition("#")
            return f"{self.root}{page.replace('/', '-').replace('pages-', 'page-')}.html" + (f"#{frag}" if frag else "")
        m = re.match(r"^(?:\.\./(essays|originals)/)?([\w.\-]+)\.md(#.*)?$", href)
        if m:
            folder = m.group(1) or ("originals" if self.here == "originals" else "essays")
            slug, frag = m.group(2), m.group(3) or ""
            if folder == "essays":
                self.links.add(slug)
                return f"{self.root}note-{slug}.html{frag}"
            return f"{self.root}original-{slug}.html{frag}"
        if href.startswith("../img/"):
            return f"{self.root}img/{href[7:]}"
        return href

    def _link_open(self, tokens, idx, options, env):
        t = tokens[idx]
        href = t.attrGet("href") or ""
        new = self.map_link(href)
        t.attrSet("href", new)
        if new.startswith("http"):
            t.attrSet("rel", "noopener")
            t.attrSet("class", "ext")
        return self.md.renderer.renderToken(tokens, idx, options, env)

    def _image(self, tokens, idx, options, env):
        t = tokens[idx]
        src = self.map_link(t.attrGet("src") or "")
        alt = html.escape(t.content or "")
        return f'<img src="{src}" alt="{alt}" loading="lazy">'

    def _heading_open(self, tokens, idx, options, env):
        t = tokens[idx]
        text = tokens[idx + 1].content
        base = slugify(text)
        hid, n = base, 2
        while hid in self.ids:
            hid, n = f"{base}-{n}", n + 1
        self.ids.add(hid)
        t.attrSet("id", hid)
        level = int(t.tag[1])
        self.toc.append({"id": hid, "text": re.sub(r"\\(.)", r"\1", text).replace("**", "").replace("*", ""), "level": level})
        return self.md.renderer.renderToken(tokens, idx, options, env)

    def _fence(self, tokens, idx, options, env):
        t = tokens[idx]
        info = t.info.strip().split(None, 1)
        kind = info[0] if info else ""
        body = html.escape(t.content.rstrip("\n"))
        if kind == "figure":
            num = info[1] if len(info) > 1 else ""
            fid = "fig-" + slugify(num) if num else ""
            cap = f"<figcaption>Figure {html.escape(num)}</figcaption>" if num else ""
            idattr = f' id="{fid}"' if fid and fid not in self.ids else ""
            self.ids.add(fid)
            # a hand transcription of the chart, if there is one (data/charts/<figure>.chart)
            sc = ROOT / "data/charts" / f"{num}.chart"
            score = f'<pre class="chart-score" hidden>{html.escape(sc.read_text(encoding="utf-8"))}</pre>' if num and sc.exists() else ""
            return f'<figure class="chart"{idattr} data-fig="{html.escape(num)}"><pre class="chart-src">{body}</pre>{score}{cap}</figure>\n'
        return f'<pre class="plain">{body}</pre>\n'

    def render(self, text: str) -> str:
        return self.md.render(text)


# =========================================================================== smart quotes
# markdown-it's typographer pairs the quotes it can; this pass curls the rest, plus every quote in
# text that never went through Markdown (song titles from data/, front matter), on the final HTML.

_ELIDED = re.compile(r"['‘](?=(?:[Ee]m|[Rr]ound|[Tt]il|[Tt]ween|[Cc]ause|\d\ds?)\b|e\s)")  # 'em 'round '67 'e
_RNR = re.compile(r"(?<=\s)['‘]n['’](?=\s)")                                          # rock 'n' roll
_PRIMED = re.compile(r"(?<![A-Za-z'‘’])(?=[A-Z]+['’])[A-Z]+(?:['’]+[A-Z]+)*['’]*(?![A-Za-z'’])")  # AA'BA'' -> AA′BA″
_OPENS = " \t\n([{—–/-“‘"
_SKIP = re.compile(r"<(script|style|pre|code|textarea)\b.*?</\1\s*>", re.S | re.I)
_TEXT = re.compile(r"(<[^>]*>)|([^<]+)")


def _prime(m: re.Match, s: str, ctx: str) -> str:
    tok = m.group()
    if re.search(r"['’](?:S|T|M|LL|RE|VE|D)$|['’](?:S|T|M|LL|RE|VE|D)['’]", tok):  # DON'T, IT'S: a word
        return tok
    q = re.findall(r"(?:^|(?<=(.)))(['‘’])", ctx + s[:m.start()])
    opener = q and (q[-1][1] == "‘" or (q[-1][1] == "'" and (q[-1][0] or " ") in _OPENS))
    if re.fullmatch(r"[A-Z]+['’]", tok) and opener:
        return tok                                                         # ‘Beatles VI’: closes a quote
    return re.sub(r"['’]{2}", "″", tok).replace("'", "′").replace("’", "′")


def smarten(s: str, ctx: str = " ") -> str:
    """Curl straight quotes in plain text; `ctx` is the text just before `s` in the same block."""
    s, prev = _PRIMED.sub(lambda m: _prime(m, s, ctx), s), (ctx or " ")[-1]
    s = _RNR.sub("’n’", _ELIDED.sub("’", s))
    out = []
    for c in s:
        if c == '"':
            c = "“" if prev in _OPENS else "”"
        elif c == "'":
            c = "‘" if prev in _OPENS else "’"
        out.append(c)
        prev = c
    return "".join(out)


def smarten_html(doc: str) -> str:
    """smarten() every text node, carrying context across tags; leaves code, scripts and attributes alone."""
    out, ctx, last = [], " ", 0
    for m in _SKIP.finditer(doc + "<script></script>"):
        for t in _TEXT.finditer(doc[last:m.start()]):
            if t.group(1):
                if re.match(r"</?(p|li|h\d|td|th|div|br|section|title|dt|dd|figcaption)\b", t.group(1), re.I):
                    ctx = " "
                out.append(t.group(1))
            else:
                text = smarten(html.unescape(t.group(2)), ctx)
                ctx = (ctx + text)[-300:]
                out.append(html.escape(text, quote=False))
        out.append(m.group(0))
        last = m.end()
    return "".join(out)[: -len("<script></script>")]


def plain_text(md_text: str) -> str:
    t = re.sub(r"```.*?```", " ", md_text, flags=re.S)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"^[#>\-\s]+", "", t, flags=re.M)
    t = t.replace("**", "").replace("\\", "")
    t = re.sub(r"(?<!\w)\*|\*(?!\w)", "", t)
    return re.sub(r"\s+", " ", t).strip()


# =========================================================================== build

def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    env = Environment(loader=FileSystemLoader(SITE / "templates"), autoescape=select_autoescape(["html"]),
                      trim_blocks=True, lstrip_blocks=True)
    MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    env.filters["nicedate"] = lambda d: f"{int(d[8:10])} {MONTHS[int(d[5:7]) - 1]} {d[:4]}" if d and len(d) >= 10 else (d or "")
    env.filters["tojson_attr"] = lambda v: html.escape(json.dumps(v, ensure_ascii=False))
    config = tomllib.loads((SITE / "site.toml").read_text())

    series = load_json("series.json")
    canon = load_json("canon.json")
    projects = load_json("projects.json")
    alphabet = load_json("alphabet.json")
    glossary = load_json("glossary.json") if (DATA / "glossary.json").exists() else []
    tempo_data = load_json("tempo.json") if (DATA / "tempo.json").exists() else {"songs": []}
    tempos = {t["key"]: t for t in tempo_data["songs"]}

    def tempo_key(title):
        t = title.lower().replace("&", "and")
        t = re.sub(r"\(.*?\)", "", t)
        return re.sub(r"[^a-z0-9]+", "", t)

    # song facts from the Beatles DB (tools/import_beatlesdb.py), by normalised title
    facts = {}
    if (DATA / "beatlesdb.json").exists():
        for f in load_json("beatlesdb.json")["songs"]:
            for k in f["keys"]:
                facts.setdefault(k, f)

    # ---------------------------------------------------------------- essays
    essays: dict[str, dict] = {}
    for kind_dir in ("essays", "originals"):
        for p in sorted((CONTENT / kind_dir).glob("*.md")):
            fm, body = read_doc(p)
            fm["folder"] = kind_dir
            fm["body_md"] = body
            # every page lives in one folder, so browsers that scope local-file storage
            # to a folder (Firefox) share reading state across the whole site
            fm["url"] = f"{'note' if kind_dir == 'essays' else 'original'}-{fm['slug']}.html"
            for part in fm.get("parts", []):
                meta = part.get("meta", {})
                part["key_info"] = parse_key(meta.get("key"))
                part["meter_short"] = parse_meter(meta.get("meter"))
                part["form_parts"] = parse_form(meta.get("form"))
                t = tempos.get(tempo_key(part.get("title", ""))) if meta else None
                if t:
                    part["bpm"], part["bpb"] = t["bpm"], t["beats_per_bar"]
                if meta and kind_dir == "essays":
                    part["facts"] = facts.get(tempo_key(part.get("title", "")))
            fm["written_date"], fm["revised_date"] = essay_dates(fm)
            essays[fm["slug"]] = fm

    def resolve(link: str | None):
        """'../essays/aditl.md#q2' -> (essay, part)"""
        if not link:
            return None, None
        m = re.match(r"^(?:\.\./essays/)?([\w\-]+)\.md(?:#(\w+))?$", link)
        if not m or m.group(1) not in essays:
            return None, None
        e = essays[m.group(1)]
        parts = e.get("parts", [])
        part = next((p for p in parts if p["id"] == m.group(2)), None) if m.group(2) else None
        if part is None:
            part = next((p for p in parts if p.get("meta")), parts[0] if parts else None)
        return e, part

    def href_of(link):
        e, part = resolve(link)
        if not e:
            return None
        anchor = f"#{part['id']}" if part and part["id"] not in ("main",) and len(e["parts"]) > 1 else ""
        return e["url"] + anchor

    # ---------------------------------------------------------------- series order (Pollack's numbering)
    series_order: list[str] = []
    alpha_by_link = {}
    for a in alphabet:
        alpha_by_link.setdefault(a["link"], a)
    for cat in series["categories"]:
        for ent in cat["entries"]:
            ent["href"] = href_of(ent["link"])
            e, _ = resolve(ent["link"])
            ent["slug"] = e["slug"] if e else None
            if e and e["slug"] not in series_order:
                series_order.append(e["slug"])
    extras = [s for s in ("interview", "qmen", "cytmb", "shellac", "iivv", "bestalts", "noteson", "copyright") if s in essays or s == "interview"]
    for s in extras:
        if s in essays and s not in series_order:
            series_order.append(s)

    # ---------------------------------------------------------------- songs (the canon, joined with essays + projects)
    proj_by_link = {}
    for per in projects["periods"]:
        for pr in per["projects"]:
            for s in pr["songs"]:
                s["href"] = href_of(s["link"])
                proj_by_link[s["link"]] = {"project": pr["no"], "project_title": pr["title"], "recorded": s["date"], "period": per["title"]}

    def song_facts(fx):
        return {"writer": fx.get("writer") or "", "writer_group": fx.get("writer_group") or "",
                "vocal": fx.get("vocal") or "", "vocal_group": fx.get("vocal_group") or "",
                "duration": fx.get("duration"), "billboard": fx.get("billboard"), "wikipedia": fx.get("wikipedia")}

    songs, seen = [], set()
    album_order = []
    for rel in canon["releases"]:
        rel["year"] = release_year(rel["info"])
        rel["slug"] = slugify(f"{rel['format']}-{rel['title']}-{rel['no']}")
        for tr in rel["tracks"]:
            tr["href"] = href_of(tr["link"])
            key = tr["canon"]
            if key in DOUBLES:
                tr["double"] = True
            if key in seen or key in DOUBLES:
                continue
            seen.add(key)
            e, part = resolve(tr["link"])
            meta = (part or {}).get("meta", {})
            al = alpha_by_link.get(tr["link"], {})
            pj = proj_by_link.get(tr["link"], {})
            fx = facts.get(tempo_key(tr["title"])) or (part or {}).get("facts") or {}
            song = {
                "canon": key, "md": tr["md"], "title": tr["title"], "kind": tr["kind"], "note": tr.get("note"),
                "href": tr["href"], "slug": e["slug"] if e else None,
                "release": rel["title"], "release_format": rel["format"], "release_no": rel["no"], "release_slug": rel["slug"],
                "year": rel["year"], "series": al.get("no") or (part or {}).get("series") or (e or {}).get("series", ""),
                "written": (e or {}).get("written_date") or "", "revised": (e or {}).get("revised_date") or "",
                "macdonald": al.get("macdonald", ""),
                "key": meta.get("key", ""), "key_info": (part or {}).get("key_info"),
                "meter": meta.get("meter", ""), "meter_short": (part or {}).get("meter_short"),
                "form": (part or {}).get("form_parts", []),
                "composer": meta.get("composer", ""),
                "recorded": pj.get("recorded", ""), "project": pj.get("project"), "project_title": pj.get("project_title", ""),
                **song_facts(fx),
            }
            songs.append(song)
            if e and e["slug"] not in album_order:
                album_order.append(e["slug"])

    # extra-canonical songs that have their own essay parts (Anthology, Shellac, unreleased ...)
    canon_hrefs = {s["href"] for s in songs}
    for slug in ("shellac", "iivv"):
        e = essays.get(slug)
        if not e:
            continue
        for part in e["parts"]:
            if not part.get("meta"):
                continue
            href = f"{e['url']}#{part['id']}"
            if href in canon_hrefs:
                continue
            meta = part["meta"]
            songs.append({"canon": "", "md": "", "title": part["title"], "kind": "extra", "note": None, "href": href,
                          "slug": slug, "release": "Not on an official release", "release_format": "", "release_no": None,
                          "release_slug": "", "year": None, "series": part.get("series", ""), "written": e.get("written_date") or "",
                          "revised": e.get("revised_date") or "", "macdonald": "",
                          "key": meta.get("key", ""), "key_info": part.get("key_info"), "meter": meta.get("meter", ""),
                          "meter_short": part.get("meter_short"), "form": part.get("form_parts", []),
                          "composer": meta.get("composer", ""), "recorded": meta.get("recorded", ""), "project": None, "project_title": "",
                          **song_facts(part.get("facts") or {})})

    # songs that each essay covers (for album prev/next + song badges)
    songs_by_slug = defaultdict(list)
    for s in songs:
        if s["slug"]:
            songs_by_slug[s["slug"]].append(s)

    # ---------------------------------------------------------------- render essays
    R = Renderer()
    backlinks = defaultdict(set)
    search_docs = []

    def nav_neighbours(order, slug):
        if slug not in order:
            return None, None
        i = order.index(slug)
        prev = essays[order[i - 1]] if i > 0 else None
        nxt = essays[order[i + 1]] if i + 1 < len(order) else None
        return prev, nxt

    rendered = {}
    for slug, e in essays.items():
        R.reset("", "originals" if e["folder"] == "originals" else "essays")
        chunks = re.split(r"^::: part (\S+)\s*$", e["body_md"], flags=re.M)
        parts_html = []
        part_meta = {p["id"]: p for p in e.get("parts", [])}
        toc = []
        # chunks: [pre, id1, body1, id2, body2 ...]
        for i in range(1, len(chunks), 2):
            pid, body = chunks[i], chunks[i + 1]
            R.toc = []
            html_body = R.render(body)
            p = part_meta.get(pid, {"id": pid, "title": ""})
            toc.append({"part": p, "items": list(R.toc)})
            parts_html.append({"part": p, "html": html_body})
        rendered[slug] = {"parts": parts_html, "toc": toc}
        if e["folder"] == "essays":
            for target in R.links:
                if target != slug:
                    backlinks[target].add(slug)
            search_docs.append({
                "u": e["url"], "t": smarten(e["title"]), "n": e.get("series", ""),
                "k": "; ".join(p.get("meta", {}).get("key", "") for p in e["parts"] if p.get("meta")),
                "x": smarten(plain_text(e["body_md"].replace("::: part", ""))),
            })

    # ---------------------------------------------------------------- glossary: where each term is used
    plain_by_slug = {d["u"].removeprefix("note-")[:-5]: d["x"].lower() for d in search_docs}
    for g in glossary:
        forms = [g["term"], *g.get("aka", []), *g.get("match", [])]
        pat = re.compile(r"\b(" + "|".join(re.escape(f.lower()).replace("\\-", "[- ]") for f in forms) + r")\b")
        hits = [s for s in series_order if s in plain_by_slug and pat.search(plain_by_slug[s])]
        g["see"] = [{"slug": s, "title": essays[s]["title"]} for s in hits[:5]]
        g["count"] = len(hits)

    # a version stamp for asset URLs, so browsers fetch new scripts and styles after each rebuild
    config["v"] = str(int(time.time()))
    config["key_colors"] = KEY_COLORS
    config["note_urls"] = [essays[s]["url"] for s in series_order if essays[s]["folder"] == "essays"]

    # ---------------------------------------------------------------- write pages
    def write(rel: str, template: str, **ctx):
        depth = rel.count("/")
        root = "../" * depth
        out = DIST / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        t = env.get_template(template)
        out.write_text(smarten_html(t.render(root=root, config=config, page_path=rel, **ctx)), encoding="utf-8")

    for slug, e in essays.items():
        if e["folder"] == "essays":
            sp, sn = nav_neighbours(series_order, slug)
            ap, an = nav_neighbours(album_order, slug)
        else:
            sp = sn = ap = an = None
        versions = []
        base = re.sub(r"\.\d$", "", slug)
        for v in sorted(essays):
            if v == base or re.fullmatch(re.escape(base) + r"\.\d", v):
                versions.append(essays[v])
        R.reset("", "originals" if e["folder"] == "originals" else "essays")
        for rv in e.get("revisions", []):
            if rv.get("link"):
                rv["href"] = R.map_link(rv["link"])
        bl = sorted((essays[s] for s in backlinks.get(slug, ())), key=lambda x: series_order.index(x["slug"]) if x["slug"] in series_order else 999)
        write(e["url"], "essay.html", e=e, r=rendered[slug], series_prev=sp, series_next=sn,
              album_prev=ap, album_next=an, versions=versions, backlinks=bl,
              songs=songs_by_slug.get(slug, []), title=e["title"])

    # interview & odyssey (by other authors)
    pages = {}
    for p in sorted((CONTENT / "pages").glob("*.md")):
        fm, body = read_doc(p)
        R.reset("", "pages")
        R.toc = []
        fm["html"] = R.render(body)
        fm["toc"] = list(R.toc)
        pages[fm["slug"]] = fm
        write(f"page-{fm['slug']}.html", "page.html", p=fm, title=fm["title"])

    by_canon_grid = [s for s in songs if s["canon"]]
    write("index.html", "home.html", songs=by_canon_grid, releases=canon["releases"], series=series,
          n_essays=sum(1 for e in essays.values() if e["folder"] == "essays"), title=None)
    write("songs.html", "songs.html", songs=songs, title="All songs")
    write("albums.html", "albums.html", canon=canon, title="Releases")
    write("series.html", "series.html", series=series, essays=essays, title="The series, in order")
    write("projects.html", "projects.html", projects=projects, title="Recording projects")
    write("glossary.html", "glossary.html", glossary=glossary, title="Glossary")
    write("about.html", "about.html", pages=pages, essays=essays, title="About this edition")
    write("404.html", "404.html", title="Not found")

    # ---------------------------------------------------------------- static assets & data scripts
    shutil.copytree(SITE / "static", DIST / "assets")
    shutil.copytree(CONTENT / "img", DIST / "img")
    (DIST / "assets/js/search-index.js").write_text(
        "window.PN_SEARCH=" + json.dumps(search_docs, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
    slim_songs = [{k: s[k] for k in ("canon", "title", "href", "release", "year", "series", "written", "key", "key_info",
                                     "meter_short", "kind", "recorded", "project", "md", "release_slug",
                                     "writer_group", "vocal_group", "duration", "billboard")} for s in songs]
    (DIST / "assets/js/songs-data.js").write_text(
        "window.PN_SONGS=" + json.dumps(slim_songs, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
    (DIST / "assets/js/glossary-data.js").write_text(
        "window.PN_GLOSSARY=" + json.dumps(glossary, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")

    n = sum(1 for _ in DIST.rglob("*.html"))
    print(f"built {n} pages -> {DIST}")


def serve():
    import functools
    import http.server
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    print("serving http://localhost:8000")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8000), handler).serve_forever()


if __name__ == "__main__":
    main()
    if "--serve" in sys.argv:
        serve()
