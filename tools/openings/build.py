# Builds public/openings/guide.json (explained openings) and public/openings/all.json (every named Lichess line).
import json, csv, re, sys, os, chess
sys.path.insert(0, os.path.dirname(__file__))
from guide0 import G as Z
from intro import I
from guide1 import G as A
from guide2 import G as B
from guide3 import G as C
OUT = sys.argv[1]
G = Z + A + B + C
def play(moves):
    b = chess.Board()
    for m in moves: b.push_san(m)
guide = []
for o in G:
    mname, mline = o["main"]
    lines = [{"name": mname, "moves": [m for m, _ in mline], "notes": [n for _, n in mline]}]
    for vname, after, vline in o["vars"]:
        lines.append({"name": vname, "moves": [m for m, _ in mline[:after]] + [m for m, _ in vline],
                      "notes": [n for _, n in mline[:after]] + [n for _, n in vline], "from": after})
    for l in lines:
        try: play(l["moves"])
        except Exception as e: print("FIX:", o["name"], "/", l["name"], e); raise SystemExit(1)
    guide.append({k: o[k] for k in ("id", "name", "side", "level", "families", "about", "ideas")} | ({"group": o["group"]} if o.get("group") else {}) | I[o["id"]] | {"lines": lines})
fam = {}
for f in "abcde":
    for r in csv.DictReader(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "co", f"{f}.tsv")), delimiter="\t"):
        name = r["name"]; fname, _, sub = name.partition(": ")
        moves = re.sub(r"\d+\.", " ", r["pgn"]).split()
        fam.setdefault(fname, []).append([r["eco"], sub, " ".join(moves)])
allf = [{"name": k, "lines": sorted(v, key=lambda x: (len(x[2].split()), x[1]))} for k, v in sorted(fam.items(), key=lambda kv: kv[0].lower())]
os.makedirs(OUT, exist_ok=True)
json.dump(guide, open(f"{OUT}/guide.json", "w"), ensure_ascii=False, separators=(",", ":"))
json.dump({"source": "Lichess chess-openings (CC0), https://github.com/lichess-org/chess-openings", "families": allf}, open(f"{OUT}/all.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(guide), "explained openings,", sum(len(o["lines"]) for o in guide), "explained lines,", sum(len(l["moves"]) for o in guide for l in o["lines"]), "notes;", len(allf), "families,", sum(len(f["lines"]) for f in allf), "named lines")
fams = {f["name"] for f in allf}
print("guide families not in Lichess list:", [x for o in guide for x in o["families"] if x not in fams])
