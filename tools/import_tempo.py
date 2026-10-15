"""Derive each song's tempo from the Isophonics Beatles beat annotations -> data/tempo.json

    python3 tools/import_tempo.py "path/to/extracted/beat/The Beatles"

The annotations (Matthew Davies et al., Centre for Digital Music, Queen Mary University of London;
http://isophonics.net/content/reference-annotations-beatles) give a time and a beat-in-bar number for
every beat of the 179 tracks on the twelve studio albums. Tempo = 60 / median inter-beat interval.
"""
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def norm(title: str) -> str:
    t = title.lower().replace("&", "and")
    t = re.sub(r"\(.*?\)", "", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def main(src: Path):
    out = []
    for f in sorted(src.rglob("*.txt")):
        times, nums = [], []
        for line in f.read_text(errors="replace").splitlines():
            parts = line.split()
            if len(parts) >= 2:
                try:
                    times.append(float(parts[0]))
                    nums.append(int(float(parts[1])))
                except ValueError:
                    pass
        if len(times) < 8:
            continue
        ibi = [b - a for a, b in zip(times, times[1:]) if b > a]
        bpm = 60 / statistics.median(ibi)
        bars = Counter(n for n, nxt in zip(nums, nums[1:]) if nxt == 1)
        bpb = bars.most_common(1)[0][0] if bars else None
        name = re.sub(r"^(CD\d_-_)?\d+_-_", "", f.stem).replace("_", " ")
        out.append({"title": name, "key": norm(name), "album": f.parent.name.split("_-_")[-1].replace("_", " "),
                    "bpm": round(bpm), "beats_per_bar": bpb})
    (ROOT / "data/tempo.json").write_text(json.dumps({
        "source": "Isophonics reference annotations for The Beatles (beat tracks), Centre for Digital Music, Queen Mary University of London",
        "url": "http://isophonics.net/content/reference-annotations-beatles",
        "songs": out}, indent=1, ensure_ascii=False))
    print(f"{len(out)} tempos -> data/tempo.json")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
