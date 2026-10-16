"""Pull song facts from the Beatles DB -> data/beatlesdb.json

    python3 tools/import_beatlesdb.py "path/to/beatlesdb/beatles_songs.json"

From each song's "yendor" record: who mainly wrote it, who sings lead, its length and its place in
Billboard's ranking of the Beatles' 50 biggest US hits. From "wikipedia": the article's address.
Songs are matched to the notes by normalised title (the same rule as tools/import_tempo.py), so
other_titles are kept as extra keys.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
BEATLES = ("Lennon", "McCartney", "Harrison", "Starkey")
# titles the notes spell differently from the DB
ALIASES = {"12-Bar Original": ["Twelve-Bar Original"],
           "With a Little Help from My Friends": ["With A Little Help From Friends"],
           "Everybody's Got Something to Hide Except Me and My Monkey": ["Everybody's Got Something To Hide Except For Me And My Monkey"]}


def norm(title: str) -> str:
    t = title.lower().replace("&", "and")
    t = re.sub(r"\(.*?\)", "", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def group(credit: str | None, kind: str) -> str | None:
    """Collapse a free-text credit to one of a few groups the site can colour by.

    'McCartney, with Lennon' -> mccartney (the first name is the main one);
    'Lennon and McCartney' -> lennon-mccartney; all four -> group; anyone else first -> other."""
    if not credit or credit.strip() in ("?", "N/A"):
        return "none" if kind == "vocal" and credit == "N/A" else None
    main = re.split(r",\s*with\b|\s\(", credit)[0]
    names = [n for n in BEATLES if n in main]
    if not names:
        return "other"
    if len(names) == 4 or (kind == "vocal" and len(names) == 3):
        return "group"
    if names == ["Lennon", "McCartney"]:
        return "lennon-mccartney"
    if len(names) == 1:
        return names[0].lower()
    return "group"


def starr(credit):
    """The DB uses Ringo's legal surname; readers know him as Starr."""
    return credit.replace("Starkey", "Starr") if credit else credit


def main(src: Path):
    songs = json.loads(src.read_text())
    out = []
    for s in songs:
        y = s.get("yendor") or {}
        wiki = (s.get("wikipedia") or {}).get("url")
        if wiki:  # the DB keeps spaces in article names; make it a proper URL
            base, _, frag = wiki.partition("#")
            page = base.removeprefix("https://en.wikipedia.org/wiki/").replace(" ", "_")
            wiki = "https://en.wikipedia.org/wiki/" + quote(page, safe="()_,!'") + ("#" + quote(frag.replace(" ", "_"), safe="()_,!'") if frag else "")
        rank = y.get("top.50.billboard")
        out.append({
            "title": s["title"],
            "keys": sorted({norm(s["title"]), *(norm(t) for t in (s.get("other_titles") or []) + ALIASES.get(s["title"], []))}),
            "writer": starr(y.get("songwriter")), "writer_group": group(y.get("songwriter"), "writer"),
            "vocal": None if y.get("lead.vocal") in (None, "?") else starr(y.get("lead.vocal")),
            "vocal_group": group(y.get("lead.vocal"), "vocal"),
            "duration": y.get("duration"),
            "billboard": rank if isinstance(rank, int) and rank > 0 else None,
            "wikipedia": wiki,
        })
    (ROOT / "data/beatlesdb.json").write_text(json.dumps({
        "source": "Beatles DB (beatles_songs.json): yendor song facts and Wikipedia links",
        "notes": "writer = who mainly wrote the song, not the official credit. billboard = rank in Billboard's 50 biggest Beatles hits in the US.",
        "songs": out}, indent=1, ensure_ascii=False))
    print(f"{len(out)} songs -> data/beatlesdb.json")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
