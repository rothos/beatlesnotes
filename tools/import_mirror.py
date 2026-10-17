# /// script
# requires-python = ">=3.11"
# dependencies = ["beautifulsoup4", "html5lib"]
# ///
"""One-time importer: Soundscapes mirror of Alan W. Pollack's "Notes on ..." series
-> clean Markdown content (content/) + structured data (data/).

Usage:  uv run tools/import_mirror.py [path/to/~soundscapes]

The mirror is treated as read-only source material. Everything this script writes
lives under content/ and data/ and can be regenerated at any time.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MIRROR = Path.home() / "Desktop/Library/Mirrors/www.icce.rug.nl/~soundscapes"
ICCE = "https://www.icce.rug.nl/~soundscapes/"   # the original host, now offline
NEW = "https://awpnoteson.info/notes/"              # where the same pages live now (same names, .html)

MIRROR = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MIRROR
AWP = MIRROR / "DATABASES/AWP"

INDEX_PAGES = {
    "awp-notes_on": "site:series",
    "awp-alphabet": "site:songs",
    "awp-beatles_canon": "site:releases",
    "awp-beatles_projects": "site:projects",
    "awp-a": "site:series#a",
    "awp-b": "site:series#b",
    "awp-c": "site:series#c",
    "awp-d": "site:series#d",
    "awp-e": "site:series#e",
}

ALL_SLUGS = {p.name.removesuffix(".shtml.html") for p in AWP.glob("*.shtml.html")}
ORIGINAL_RE = re.compile(r"^(.+)\.(\d)$")


def is_original(slug: str) -> bool:
    return bool(ORIGINAL_RE.match(slug))


# --------------------------------------------------------------------------- links

def map_href(href: str, here: str) -> str | None:
    """Map a mirror href to a content-relative link. `here` is 'essays' or 'originals' or 'pages'."""
    href = href.strip()
    if not href or href.startswith("javascript:"):
        return None
    if href.startswith(("http://", "https://", "mailto:", "ftp://")):
        return href
    m = re.match(r"^([\w.\-]+?)\.shtml(?:\.html)?(#.*)?$", href)
    if m:
        slug, frag = m.group(1), m.group(2) or ""
        if slug == "interview":   # by Ian Hammond: lives with the other non-Pollack pages
            return "site:pages/interview" + frag
        if slug in INDEX_PAGES:
            target = INDEX_PAGES[slug]
            return target if "#" in target or not frag else target + frag
        if slug in ALL_SLUGS:
            folder = "originals" if is_original(slug) else "essays"
            if folder == here:
                return f"{slug}.md{frag}"
            return f"../{folder}/{slug}.md{frag}"
    if href.startswith("#"):
        return href
    # anything else relative: point at the live Soundscapes site
    clean = re.sub(r"^(\.\./)+", "", href)
    if href.startswith("../../"):
        return NEW + re.sub(r"\.shtml\b", ".html", clean.rsplit("/", 1)[-1])
    return NEW + re.sub(r"\.shtml\b", ".html", clean)


# --------------------------------------------------------------------------- inline markdown

def esc(text: str) -> str:
    text = text.replace("\\", "\\\\")
    for ch in "*_`[]":
        text = text.replace(ch, "\\" + ch)
    return text.replace("<", "&lt;")


def fix_arrows_prose(s: str) -> str:
    # the HTML conversion turned Pollack's ASCII "->" into "-»"
    return re.sub(r"\s*-»\s*", " → ", s)


def inline(node, here: str) -> str:
    out = []
    for child in node.children if isinstance(node, Tag) else [node]:
        if isinstance(child, NavigableString):
            if child.__class__.__name__ == "Comment":
                continue
            out.append(esc(str(child)))
            continue
        name = child.name
        if name in ("script", "style", "audio"):
            continue
        if name == "img":
            src = child.get("src", "")
            if "WHITEBALL" in src or "LAYOUT/" in src:
                continue
            out.append(f" ![{esc(child.get('alt', ''))}]({image_src(src)}) ")
            continue
        if name == "br":
            out.append("\\\n")
            continue
        inner = inline(child, here)
        if name in ("strong", "b"):
            out.append(wrap(inner, "**"))
        elif name in ("em", "i", "cite"):
            out.append(wrap(inner, "*"))
        elif name in ("tt", "code"):
            out.append("`" + child.get_text() + "`")
        elif name in ("sup", "sub"):
            out.append(f"<{name}>{inner}</{name}>")
        elif name == "a":
            href = child.get("href")
            target = map_href(href, here) if href else None
            if target and inner.strip():
                out.append(f"[{inner.strip()}]({target})")
            else:
                out.append(inner)
        else:
            out.append(inner)
    return "".join(out)


def wrap(inner: str, mark: str) -> str:
    if not inner.strip():
        return inner
    lead = inner[: len(inner) - len(inner.lstrip())]
    trail = inner[len(inner.rstrip()):]
    return f"{lead}{mark}{inner.strip()}{mark}{trail}"


def clean_inline(s: str) -> str:
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t\r\f\v]*\n[ \t\r\f\v]*", " ", s) if "\\\n" not in s else re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"[ \t]{2,}", " ", s).strip()
    s = fix_arrows_prose(s)
    # don't let a paragraph accidentally become a list / heading / quote
    s = re.sub(r"^(\d+)([.)])(\s)", r"\1\\\2\3", s)
    s = re.sub(r"^([-+#>=])(\s|$)", r"\\\1\2", s)
    return s


IMAGES_USED: set[str] = set()


def image_src(src: str) -> str:
    name = src.split("/")[-1]
    IMAGES_USED.add(src)
    return f"../img/{name}"


# --------------------------------------------------------------------------- block flattening

BLOCK_TAGS = {"ul", "ol", "pre", "h1", "h2", "h3", "h4", "h5", "p", "table", "blockquote", "hr", "div", "audio"}


def list_md(el: Tag, here: str, depth: int = 0) -> str:
    lines = []
    ordered = el.name == "ol"
    n = 0
    for li in el.find_all("li", recursive=False):
        n += 1
        marker = f"{n}. " if ordered else "- "
        pad = " " * (depth * (3 if ordered else 2))
        nested = [c for c in li.children if isinstance(c, Tag) and c.name in ("ul", "ol")]
        for c in nested:
            c.extract()
        text = clean_inline(inline(li, here))
        text = re.sub(r"^\\([-+#>=])", r"\1", text) if False else text
        lines.append(pad + marker + text)
        for c in nested:
            lines.append(list_md(c, here, depth + 1))
    return "\n".join(lines)


def flatten_cell(cell: Tag, here: str, events: list):
    """Turn one content <td> into a sequence of events."""
    buf: list = []

    def flush():
        if buf:
            frag = BeautifulSoup("<div></div>", "html.parser").div
            for b in buf:
                frag.append(b)
            text = clean_inline(inline(frag, here))
            if text and text not in ("\\", "&nbsp;"):
                events.append(("para", text))
            buf.clear()

    for child in list(cell.children):
        if isinstance(child, Tag) and child.name == "a" and child.get("name") and not child.get_text(strip=True):
            flush()
            events.append(("anchor", child["name"]))
            continue
        if isinstance(child, Tag) and child.name == "img" and "IMAGES/" in child.get("src", ""):
            flush()
            events.append(("img", image_src(child["src"]), child.get("alt", "")))
            continue
        if isinstance(child, Tag) and child.name in BLOCK_TAGS:
            flush()
            n = child.name
            if n in ("ul", "ol"):
                events.append(("list", list_md(child, here)))
            elif n == "pre":
                events.append(("pre", child))
            elif n == "h1":
                events.append(("h1", child.get_text(" ", strip=True)))
            elif n in ("h2", "h3", "h4"):
                events.append((n, clean_inline(inline(child, here))))
            elif n == "h5":
                events.append(("h5", clean_inline(inline(child, here))))
            elif n == "hr":
                events.append(("hr",))
            elif n in ("p", "div", "blockquote"):
                flatten_cell(child, here, events)
            elif n == "table":
                events.append(("para", clean_inline(inline(child, here))))
            continue
        if isinstance(child, Tag) and child.name == "b" and child.get_text().strip().startswith("Notes on ... Series"):
            flush()
            events.append(("series", child.get_text(" ", strip=True)))
            continue
        if isinstance(child, Tag) and child.name in ("b", "strong") and re.match(r"^by\s", child.get_text(strip=True)):
            flush()
            events.append(("by", child.get_text(" ", strip=True)[3:].strip()))
            continue
        buf.append(child)
    flush()


def page_events(path: Path, here: str) -> list:
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "html5lib")
    events: list = []
    h1 = soup.find("h1")
    table = h1.find_parent("table") if h1 else soup.find("table", summary=True)
    for tr in table.find_all("tr", recursive=False) or table.find("tbody").find_all("tr", recursive=False):
        cells = tr.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        cell = cells[1]
        if cell.find("table") and cell.find(class_="menu"):
            continue
        margin = cells[0].get_text(strip=True)
        flatten_cell(cell, here, events)
        # keep FAQ / interview numbering that lives in the margin column
        if margin and re.fullmatch(r"\d+", margin) and events and events[-1][0] == "para" and events[-1][1].startswith("*"):
            pass
    # html5lib wraps rows in tbody
    if not events:
        for tr in table.find("tbody").find_all("tr", recursive=False):
            cells = tr.find_all("td", recursive=False)
            if len(cells) >= 2 and not (cells[1].find("table") and cells[1].find(class_="menu")):
                flatten_cell(cells[1], here, events)
    return events


# --------------------------------------------------------------------------- metadata blocks

META_LABELS = {
    "key": "key", "meter": "meter", "form": "form", "cd": "cd", "recorded": "recorded",
    "uk-release": "uk_release", "us-release": "us_release", "composer": "composer",
    "composers": "composer", "influential version": "influential_version",
    "original version": "influential_version",
}


def parse_meta(text: str) -> list[tuple[str, str]] | None:
    lines = [l.rstrip() for l in text.strip("\n").split("\n") if l.strip()]
    label_re = re.compile(r"^\s*([A-Za-z][A-Za-z\-]*(?: [A-Za-z\-]+){0,2}):(?:\s+|$)(.*)$")
    fields: list[list[str]] = []
    pending = ""
    repeat = None
    for i, l in enumerate(lines):
        l = re.sub(r'^(\s*)For":', r"\1Form:", l)  # typo in "You've Got To Hide Your Love Away"
        if re.fullmatch(r"\s*-+\s*\d+\s*[xX]\s*-+\s*", l):
            repeat = l  # a "--- 2X ---" bracket drawn over the following Form line
            continue
        m = label_re.match(l)
        if m and repeat is not None:
            fields.append(["form_raw", repeat + "\n" + l + "".join(
                "\n" + n for n in lines[i + 1:] if not label_re.match(n)) ])
            # (form_raw is completed lazily below; keep only the contiguous continuation lines)
            raw = [repeat, l]
            for n in lines[i + 1:]:
                if label_re.match(n):
                    break
                raw.append(n)
            fields[-1][1] = dedent("\n".join(raw))
            repeat = None
        if m:
            fields.append([(pending + " " + m.group(1)).strip(), m.group(2).strip()])
            pending = ""
        elif re.fullmatch(r"\s*[A-Za-z]+", l) and i + 1 < len(lines) and label_re.match(lines[i + 1]):
            pending = l.strip()
        elif fields:
            fields[-1][1] += "\n" + l.strip()
        else:
            return None
    if not any(f[0].lower() in ("key", "meter", "cd", "recorded") for f in fields):
        return None
    return [(f[0], f[1]) for f in fields]


def meta_dict(fields):
    d = {}
    for label, value in fields:
        k = META_LABELS.get(label.lower(), re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_"))
        if k == "form_raw":
            d[k] = value
            continue
        if k == "form":
            parts = [p.strip() for p in re.split(r"\|", value.replace("\n", " ")) if p.strip()]
            value = " | ".join(parts)
        else:
            value = re.sub(r"\s*\n\s*", " ", value).strip()
        if k in d:
            d[k] += "; " + value
        else:
            d[k] = value
    return d


def parse_revisions(text: str, pre: Tag, here: str):
    revs = []
    links = {a.get_text(strip=True): map_href(a.get("href", ""), here) for a in pre.find_all("a")}
    for line in text.strip().split("\n")[1:]:
        m = re.match(r"^\s*(\d{6})\s+([\d.]+\w*)\s+(.*)$", line)
        if not m:
            if line.strip():
                revs.append({"date": "", "version": "", "note": line.strip()})
            continue
        note = m.group(3).strip()
        rev = {"date": fmt_date(m.group(1)), "version": m.group(2), "note": note}
        if note in links and links[note]:
            rev["link"] = links[note]
        revs.append(rev)
    return revs


def fmt_date(mmddyy: str) -> str:
    mm, dd, yy = mmddyy[:2], mmddyy[2:4], mmddyy[4:]
    year = ("19" if int(yy) > 50 else "20") + yy
    return f"{year}-{mm}-{dd}"


def pre_text(pre: Tag) -> str:
    t = pre.get_text()
    t = t.replace("\xa0", " ").replace("-»", "->").replace("»", ">")
    return t.strip("\n").rstrip()


# --------------------------------------------------------------------------- assemble essay

def title_from_h1(h: str) -> str:
    h = re.sub(r"\s+", " ", h).strip()
    m = re.match(r'^Notes on "([^"]*)"$', h)
    if m:
        return m.group(1)
    # several quoted titles, or a descriptive heading: keep it, with typographic quotes
    h = re.sub(r'"([^"]*)"', r"“\1”", h)
    if h.startswith("Notes on "):   # the page already says "Notes on …"
        h = h[len("Notes on "):]
        h = h[0].upper() + h[1:]
    return h


def series_info(s: str):
    m = re.search(r"Series\s+(.*?)\s*\(([^)]*)\)\s*$", s)
    if not m:
        m2 = re.search(r"Series\s+(.*)$", s)
        return (m2.group(1).strip() if m2 else ""), ""
    return m.group(1).lstrip("#").strip(), m.group(2).strip()


def build_essay(path: Path, here: str):
    slug = path.name.removesuffix(".shtml.html")
    soup_title = re.search(r"<title>(.*?)</title>", path.read_text(errors="replace"), re.S).group(1)
    events = page_events(path, here)

    parts: list[dict] = []
    page = {"slug": slug, "page_title": BeautifulSoup(soup_title, "html.parser").get_text().strip()}
    body: list[list[str]] = []  # per part
    pending_anchor = None
    signoff_next = False
    for ev in events:
        kind = ev[0]
        if kind == "anchor":
            pending_anchor = ev[1]
            continue
        if kind == "h1":
            parts.append({"id": pending_anchor or ("main" if not parts else f"p{len(parts)}"),
                          "title": title_from_h1(ev[1])})
            body.append([])
            pending_anchor = None
            continue
        if not parts:
            continue
        part, blocks = parts[-1], body[-1]
        if kind == "series":
            part["series"], part["code"] = series_info(ev[1])
        elif kind == "by":
            page.setdefault("author", ev[1])
        elif kind == "pre":
            text = pre_text(ev[1])
            if text.startswith("Revision History"):
                page["revisions"] = parse_revisions(text, ev[1], here)
                continue
            if "meta" not in part and not blocks:
                fields = parse_meta(text)
                if fields:
                    part["meta"] = meta_dict(fields)
                    continue
            m = re.search(r"\n?\s*\[(Figure|Fig\.?|Example)\s*([^\]]*)\]\s*$", text)
            if m:
                fig = text[: m.start()].rstrip()
                blocks.append(f"```figure {m.group(2).strip()}\n{dedent(fig)}\n```")
            else:
                blocks.append(f"```text\n{dedent(text)}\n```")
        elif kind == "h2":
            blocks.append("## " + ev[1])
        elif kind in ("h3", "h4"):
            blocks.append("### " + ev[1])
        elif kind == "h5":
            page["copyright"] = re.sub(r"\\(.)", r"\1", ev[1])
        elif kind == "list":
            blocks.append(ev[1])
        elif kind == "img":
            blocks.append(f"![{esc(ev[2])}]({ev[1]})")
        elif kind == "para":
            t = ev[1]
            if re.fullmatch(r"Regards,?", t):
                signoff_next = True
                continue
            m = re.fullmatch(r"Regards,?\s*\\?\s*Alan\s*\(([^)]*)\)", t)
            if m:
                page["signoff"] = m.group(1)
                continue
            m = re.fullmatch(r"Alan\s*\(([^)]*)\)", t)
            if m and signoff_next:
                page["signoff"] = m.group(1)
                signoff_next = False
                continue
            if signoff_next and t == "Alan":
                page["signoff"] = ""
                signoff_next = False
                continue
            blocks.append(t)
    return page, parts, body


def dedent(t: str) -> str:
    lines = t.split("\n")
    ind = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return "\n".join(l[ind:] for l in lines)


# --------------------------------------------------------------------------- TOML out

def tq(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(tq(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{tk(k)} = {tq(x)}" for k, x in v.items()) + " }"
    return json.dumps(str(v), ensure_ascii=False)


def tk(k: str) -> str:
    return k if re.fullmatch(r"[A-Za-z0-9_-]+", k) else json.dumps(k)


def frontmatter(fm: dict) -> str:
    out = ["+++"]
    tables = []
    for k, v in fm.items():
        if v is None or v == "" or v == []:
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict):
            tables.append((k, v))
        else:
            out.append(f"{tk(k)} = {tq(v)}")
    for k, rows in tables:
        for row in rows:
            out.append("")
            out.append(f"[[{k}]]")
            sub = {}
            for rk, rv in row.items():
                if isinstance(rv, dict):
                    sub[rk] = rv
                elif rv not in (None, ""):
                    out.append(f"{tk(rk)} = {tq(rv)}")
            for sk, sv in sub.items():
                out.append(f"[{k}.{sk}]")
                for mk, mv in sv.items():
                    out.append(f"{tk(mk)} = {tq(mv)}")
    out.append("+++")
    return "\n".join(out)


# --------------------------------------------------------------------------- essay kinds

def classify(slug: str, parts) -> str:
    if slug in ("noteson", "bestalts", "copyright", "interview"):
        return "extra"
    if slug.startswith("covers") or slug == "ltsep":
        return "covers"
    if len(parts) > 1:
        return "multi"
    if not parts or "meta" not in parts[0]:
        return "essay"
    return "song"


def write_essay(path: Path):
    slug = path.name.removesuffix(".shtml.html")
    original = is_original(slug)
    here = "originals" if original else "essays"
    page, parts, body = build_essay(path, here)
    if not parts:
        print("  !! no parts:", slug)
        return None
    main = parts[0]
    fm = {
        "title": main["title"],
        "slug": slug,
        "kind": "original" if original else classify(slug, parts),
        "series": main.get("series", ""),
        "code": main.get("code", ""),
        "author": page.get("author", "Alan W. Pollack"),
        "signoff": page.get("signoff"),
        "copyright": page.get("copyright"),
        "source": NEW + f"{slug}.html",
    }
    if original:
        fm["current"] = f"../essays/{ORIGINAL_RE.match(slug).group(1)}.md"
    fm["parts"] = [{k: v for k, v in p.items() if k != "title" or True} for p in parts]
    fm["revisions"] = page.get("revisions", [])
    md = [frontmatter(fm), ""]
    for p, blocks in zip(parts, body):
        md.append(f"::: part {p['id']}")
        md.append("")
        for b in blocks:
            md.append(b)
            md.append("")
    out = ROOT / "content" / here / f"{slug}.md"
    out.write_text("\n".join(md).rstrip() + "\n", encoding="utf-8")
    return fm


# --------------------------------------------------------------------------- data: indexes

def rows_text(path: Path):
    soup = BeautifulSoup(path.read_text(errors="replace"), "html5lib")
    return soup


def import_series_categories():
    soup = rows_text(AWP / "awp-notes_on.shtml.html")
    cats = []
    for a in soup.find_all("a", href=re.compile(r"^awp-[a-e]\.shtml")):
        if not a.get_text(strip=True):
            continue
        td = a.find_parent("td")
        letter = re.match(r"awp-([a-e])", a["href"]).group(1)
        if any(c["id"] == letter for c in cats):
            continue
        text = td.get_text(" ", strip=True)
        m = re.match(r"(.*?)\s*\((\d+)-(\d+)\)\.\s*(.*)$", text)
        title, lo, hi, desc = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
        cats.append({"id": letter, "title": title.strip(), "from": lo, "to": hi, "description": desc.strip(), "entries": []})
    intro_td = soup.find(string=re.compile("In 1989 the American musicologist")).find_parent("td")
    # entries from each category page
    for c in cats:
        s = rows_text(AWP / f"awp-{c['id']}.shtml.html")
        intro = None
        for tr in s.find_all("tr"):
            tds = tr.find_all("td", recursive=False)
            if len(tds) == 4 and tds[0].find("strong", class_="margin") and tds[1].find("a"):
                a = tds[1].find("a")
                c["entries"].append({
                    "no": tds[0].get_text(strip=True),
                    "title": a.get_text(" ", strip=True),
                    "link": map_href(a["href"], "data"),
                    "years": tds[2].get_text(strip=True).strip("()"),
                    "macdonald": tds[3].get_text(strip=True),
                })
            elif len(tds) >= 2 and intro is None:
                t = tds[1].get_text(" ", strip=True)
                if len(t) > 200 and "Copyright" not in t:
                    intro = t
        c["intro"] = intro or ""
    return {"intro": intro_td.get_text(" ", strip=True), "categories": cats}


def import_alphabet():
    s = rows_text(AWP / "awp-alphabet.shtml.html")
    out = []
    for tr in s.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) >= 4 and tds[1].find("a") and tds[0].get_text(strip=True):
            a = tds[1].find("a")
            out.append({
                "no": tds[0].get_text(strip=True),
                "title": a.get_text(" ", strip=True),
                "link": map_href(a["href"], "data"),
                "year": tds[2].get_text(strip=True).strip("()"),
                "macdonald": tds[3].get_text(strip=True) if len(tds) > 3 else "",
            })
    return out


def import_canon():
    s = rows_text(AWP / "awp-beatles_canon.shtml.html")
    releases = []
    for tr in s.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 2:
            continue
        num = tds[0].get_text(strip=True)
        td = tds[1]
        items = td.find_all("li")
        if not items:
            continue
        head_strong = td.find("strong")
        if num.isdigit() and head_strong:
            text = td.get_text(" ", strip=True)
            m = re.match(r"^(Single|LP|EP)\s*:\s*(.*?)\s*\((.*?)\)\s*(?=\d{3}|C\d\d|T\d\d|$)", text)
            fmt = text.split(":")[0].strip()
            m = re.match(r"^\w+\s*:\s*(.*?)\s*\(([^()]*released[^()]*(?:\([^()]*\)[^()]*)*)\)", text)
            title = m.group(1) if m else head_strong.get_text(" ", strip=True)
            info = m
            img = td.find("img")
            rel = {"no": int(num), "format": fmt, "title": title,
                   "info": info.group(2) if info else "",
                   "cover": image_src(img["src"]).replace("../img/", "") if img else None,
                   "tracks": []}
            releases.append(rel)
        elif releases and not num:
            rel = releases[-1]   # continuation row (White Album side 2..)
            if td.find("a", attrs={"name": True}) or "Notes" in td.get_text()[:20]:
                continue
        else:
            continue
        for li in items:
            font = li.find("font")
            a = li.find("a")
            txt = li.get_text(" ", strip=True)
            m = re.match(r"^(\w+)(?:\s+\1)?\s*(?:/\s*(MD\w+))?\s*:\s*(.*)$", txt)  # source has "100 100 / MD103"
            if not m:
                continue
            canon, md, rest = m.groups()
            title = a.get_text(" ", strip=True) if a else rest
            note = rest[len(title):].strip() if rest.startswith(title) else ""
            rel["tracks"].append({
                "canon": canon, "md": (md or "").removeprefix("MD"), "title": title,
                "link": map_href(a["href"], "data") if a else None,
                "first": bool(font),
                "kind": "cover" if canon.startswith("C") else ("traditional" if canon.startswith("T") else "original"),
                "note": note.strip("() ") or None,
            })
    # footnote + intro text
    intro = s.find(string=re.compile("The official Beatles' canon covers")).find_parent("td").get_text(" ", strip=True)
    notes = []
    anchor = s.find("a", attrs={"name": "Note01"})
    if anchor:
        for tr in [anchor.find_parent("tr")] + anchor.find_parent("tr").find_all_next("tr"):
            tds = tr.find_all("td", recursive=False)
            if len(tds) < 2 or tds[1].find("img", src=re.compile("UP.GIF")):
                break
            lead = re.sub(r"\s+", " ", "".join(t if isinstance(t, str) else t.get_text(" ") for t in tds[-1].children if getattr(t, "name", None) not in ("ul", "audio"))).strip()
            items = [li.get_text(" ", strip=True) for li in tds[-1].find_all("li")]
            if lead or items:
                notes.append({"text": re.sub(r"^1\.\s*", "", lead), "items": items})
    return {"intro": re.sub(r"\s*\[\s*1\s*\]\s*", " ", intro).strip(), "notes": notes, "releases": releases}


def import_projects():
    s = rows_text(AWP / "awp-beatles_projects.shtml.html")
    periods, cur_period, cur = [], None, None
    for tr in s.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 2:
            continue
        t = tds[1].get_text(" ", strip=True)
        if tds[1].get("bgcolor") and t.startswith("Recording project"):
            m = re.match(r"Recording project (\d+):\s*(.*?)\s*\((.*?)\)", t)
            cur = {"no": int(m.group(1)), "title": m.group(2), "span": m.group(3), "songs": []}
            cur_period["projects"].append(cur)
        elif tds[1].get("align") == "center" and tds[1].find("strong") and t.endswith("period"):
            cur_period = {"title": t, "projects": []}
            periods.append(cur_period)
        elif cur and tds[0].find("strong", class_="margin") and tds[1].find("a"):
            a = tds[1].find("a")
            date = t.split(":")[0].strip()
            cur["songs"].append({"no": tds[0].get_text(strip=True), "date": date,
                                 "title": a.get_text(" ", strip=True), "link": map_href(a["href"], "data")})
    intro = s.find(string=re.compile("consciously developed")).find_parent("td").get_text(" ", strip=True)
    return {"intro": intro, "credit": "Tuomas Eerola; published as Appendix 2 of Heinonen & Eerola (1998), “Songwriting, recording, and style change”, Beatlestudies 1, University of Jyväskylä.", "periods": periods}


def import_about_page(path: Path, slug: str, author: str, title: str):
    """Odyssey (Tillekens) and other non-Pollack prose pages -> content/pages."""
    events = page_events(path, "pages")
    md = []
    for ev in events:
        if ev[0] == "anchor":
            md.append(f'<a id="{ev[1]}"></a>')
        elif ev[0] == "para":
            md.append(ev[1])
        elif ev[0] == "list":
            md.append(ev[1])
        elif ev[0] in ("h2", "h3"):
            md.append(("## " if ev[0] == "h2" else "### ") + ev[1])
        elif ev[0] == "img":
            md.append(f"![{esc(ev[2])}]({ev[1]})")
        elif ev[0] == "pre":
            md.append("```text\n" + pre_text(ev[1]) + "\n```")
    fm = frontmatter({"title": title, "slug": slug, "author": author,
                      "source": NEW + path.name.replace(".shtml.html", ".html")})
    (ROOT / "content/pages" / f"{slug}.md").write_text(fm + "\n\n" + "\n\n".join(md) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- main

def main():
    print("mirror:", MIRROR)
    essays = []
    for p in sorted(AWP.glob("*.shtml.html")):
        slug = p.name.removesuffix(".shtml.html")
        if slug.startswith("awp-") or slug == "interview":
            continue
        fm = write_essay(p)
        if fm:
            essays.append(fm["slug"])
    print(f"essays/originals written: {len(essays)}")

    # the interview is by Ian Hammond, the Odyssey by Ger Tillekens
    import_about_page(AWP / "interview.shtml.html", "interview", "Ian Hammond", "“I was nervously waiting …” — An interview with Alan W. Pollack")
    import_about_page(MIRROR / "A_Beatles_Odyssey.shtml", "odyssey", "Ger Tillekens", "A Beatles’ Odyssey")

    data = ROOT / "data"
    (data / "series.json").write_text(json.dumps(import_series_categories(), indent=1, ensure_ascii=False))
    (data / "alphabet.json").write_text(json.dumps(import_alphabet(), indent=1, ensure_ascii=False))
    (data / "canon.json").write_text(json.dumps(import_canon(), indent=1, ensure_ascii=False))
    (data / "projects.json").write_text(json.dumps(import_projects(), indent=1, ensure_ascii=False))

    # copy images that are referenced
    img_dir = ROOT / "content/img"
    img_dir.mkdir(parents=True, exist_ok=True)
    for src in list(IMAGES_USED) + [f"IMAGES/Beatles_cover{n:02d}.JPG" for n in range(1, 14)]:
        name = src.split("/")[-1]
        for cand in (AWP / "IMAGES" / name, MIRROR / "IMAGES" / name):
            if cand.exists():
                (img_dir / name).write_bytes(cand.read_bytes())
                break
        else:
            print("  missing image:", src)
    print("done")


if __name__ == "__main__":
    main()
