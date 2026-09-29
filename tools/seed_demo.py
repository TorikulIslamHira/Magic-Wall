#!/usr/bin/env python3
"""Fill an empty Magic Wall database with realistic-looking DEMO data for rehearsals.

Everything here is fictional: parties are "দল ক/খ/গ/ঘ", candidates are made-up names,
vote counts are random. War and budget entries are marked "ডেমো". Wipe the database
before real use.

The API must have started once against the database (so migrations have created the
schema). Stdlib only:

    python3 tools/seed_demo.py --db src/MagicWall.Api/magicwall.db

With docker compose (the database lives in the volume):

    docker run --rm --user 1654 -v magicwall_magicwall-data:/data -v "$PWD/tools:/tools:ro" \
      python:3.13-slim python /tools/seed_demo.py --db /data/magicwall.db
"""
import argparse
import csv
import os
import random
import sqlite3
import sys

here = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument("--db", default=os.path.join(here, "..", "src", "MagicWall.Api", "magicwall.db"))
parser.add_argument("--declared", type=float, default=0.82, help="share of seats with results (0-1)")
parser.add_argument("--seed", type=int, default=2026)
args = parser.parse_args()

rng = random.Random(args.seed)
BN = "০১২৩৪৫৬৭৮৯"
bn = lambda n: "".join(BN[int(d)] if d.isdigit() else d for d in str(n))

if not os.path.exists(args.db):
    sys.exit(f"Database not found: {args.db}. Start the API once so migrations create it.")

con = sqlite3.connect(args.db)
c = con.cursor()
if c.execute("SELECT COUNT(*) FROM Constituencies").fetchone()[0] > 0:
    sys.exit("Database already has data. Seed only a fresh database.")

with open(os.path.join(here, "data", "bd-districts.csv"), encoding="utf-8") as f:
    districts = list(csv.DictReader(f))

# ---------- election ----------
PARTIES = ["দল ক", "দল খ", "দল গ", "দল ঘ"]
SYMBOLS = {"দল ক": "নৌকা", "দল খ": "ধানের শীষ", "দল গ": "লাঙ্গল", "দল ঘ": "দাঁড়িপাল্লা", "স্বতন্ত্র": "ঈগল"}
# Regional strength per division gives the map believable geographic patterns.
STRENGTH = {
    "dhaka":      [1.25, 1.00, 0.45, 0.35],
    "chattogram": [0.95, 1.20, 0.35, 0.55],
    "rajshahi":   [0.90, 1.25, 0.40, 0.60],
    "khulna":     [1.20, 0.95, 0.35, 0.50],
    "barishal":   [1.10, 1.10, 0.30, 0.40],
    "sylhet":     [1.00, 1.05, 0.30, 0.50],
    "rangpur":    [0.85, 0.80, 1.35, 0.35],
    "mymensingh": [1.15, 1.00, 0.55, 0.35],
}
FIRST = ["রহিম", "করিম", "সালমা", "নাসরিন", "জামাল", "কামাল", "ফারহানা", "মাহমুদ", "তানভীর", "শাহানা",
         "রফিক", "আসিফ", "নুসরাত", "হাসান", "মিতু", "আরিফ", "সুমাইয়া", "ইমরান", "রুমানা", "শফিক"]
LAST = ["আহমেদ", "হোসেন", "চৌধুরী", "ইসলাম", "রহমান", "খান", "সরকার", "উদ্দিন", "মিয়া", "তালুকদার"]
name = lambda: f"{rng.choice(FIRST)} {rng.choice(LAST)}"

seat_count = 0
for d in districts:
    for i in range(1, int(d["seats"]) + 1):
        seat_count += 1
        voters = rng.randint(260_000, 560_000)
        c.execute("INSERT INTO Constituencies (Name, SvgPathId, TotalVoters, DistrictCode) VALUES (?,?,?,?)",
                  (f"{d['name_bn']}-{bn(i)}", f"{d['code']}-{i}", voters, d["code"]))
        seat_id = c.lastrowid

        field = PARTIES[:] + (["স্বতন্ত্র"] if rng.random() < 0.3 else [])
        cand_ids = []
        for party in field:
            c.execute("INSERT INTO Candidates (Name, PartyName, Symbol, ConstituencyId) VALUES (?,?,?,?)", (name(), party, SYMBOLS[party], seat_id))
            cand_ids.append((c.lastrowid, party))

        if rng.random() > args.declared:
            continue   # results not in yet: the seat stays grey on the map
        turnout = rng.uniform(0.42, 0.72)
        weights = [(STRENGTH[d["division"]][PARTIES.index(p)] if p in PARTIES else 0.25) * rng.uniform(0.6, 1.4)
                   for _, p in cand_ids]
        total = sum(weights)
        for (cand_id, _), w in zip(cand_ids, weights):
            c.execute("INSERT INTO ElectionResults (ConstituencyId, CandidateId, VotesReceived) VALUES (?,?,?)",
                      (seat_id, cand_id, int(voters * turnout * w / total)))

# ---------- sports ----------
c.execute("INSERT INTO Matches (Title, Sport, MatchDate, TeamA, TeamB) VALUES (?,?,?,?,?)",
          ("ডেমো লিগ · ফাইনাল", "Football", "2026-09-20 19:00:00", "ঢাকা একাদশ", "চট্টগ্রাম একাদশ"))
match_id = c.lastrowid
players = []
for pname, team, role in [("সাকিব হাসান", "ঢাকা একাদশ", "স্ট্রাইকার"), ("রাকিব খান", "ঢাকা একাদশ", "মিডফিল্ডার"),
                          ("তামিম চৌধুরী", "চট্টগ্রাম একাদশ", "স্ট্রাইকার"), ("জুবায়ের আহমেদ", "চট্টগ্রাম একাদশ", "গোলরক্ষক")]:
    c.execute("INSERT INTO Players (Name, Team, Role) VALUES (?,?,?)", (pname, team, role))
    players.append(c.lastrowid)
for minute in range(2, 90, 2):
    x, y = rng.uniform(40, 96), rng.uniform(12, 88)
    kind = rng.choices(["Pass", "Shot", "Tackle"], [6, 2, 1])[0]
    end = (None, None)
    if kind == "Pass":
        end = (min(100, x + rng.uniform(4, 18)), min(100, max(0, y + rng.uniform(-14, 14))))
    elif kind == "Shot":
        end = (100.0, rng.uniform(44, 56))
    c.execute("INSERT INTO MatchEvents (MatchId, PlayerId, EventType, CoordinateX, CoordinateY, EndCoordinateX, EndCoordinateY, Minute) VALUES (?,?,?,?,?,?,?,?)",
              (match_id, players[0], kind, round(x, 1), round(y, 1), end[0] and round(end[0], 1), end[1] and round(end[1], 1), minute))
c.execute("INSERT INTO MatchEvents (MatchId, PlayerId, EventType, CoordinateX, CoordinateY, Minute) VALUES (?,?,?,?,?,?)",
          (match_id, players[0], "Goal", 91.0, 49.0, 77))

# Cricket and kabaddi demo matches, so every surface can be rehearsed.
for title, sport, team_a, team_b, player, role, kinds in [
    ("ডেমো টি-টোয়েন্টি · সেমিফাইনাল", "Cricket", "রাজশাহী রয়্যালস", "সিলেট স্ট্রাইকার্স", "নাসির হোসেন", "ব্যাটার",
     ["Four", "Four", "Six", "Delivery", "Catch"]),
    ("ডেমো কাবাডি লিগ", "Kabaddi", "বরিশাল বুলস", "খুলনা টাইগার্স", "আরিফ রাব্বানী", "রেইডার",
     ["Raid", "Raid", "Bonus", "Tackle", "AllOut"]),
]:
    c.execute("INSERT INTO Matches (Title, Sport, MatchDate, TeamA, TeamB) VALUES (?,?,?,?,?)",
              (title, sport, "2026-09-25 18:00:00", team_a, team_b))
    extra_match = c.lastrowid
    c.execute("INSERT INTO Players (Name, Team, Role) VALUES (?,?,?)", (player, team_a, role))
    extra_player = c.lastrowid
    for minute in range(1, 40, 2):
        c.execute("INSERT INTO MatchEvents (MatchId, PlayerId, EventType, CoordinateX, CoordinateY, Minute) VALUES (?,?,?,?,?,?)",
                  (extra_match, extra_player, rng.choice(kinds), round(rng.uniform(8, 92), 1), round(rng.uniform(12, 88), 1), minute))

# ---------- war (fictional forces over real geography, clearly marked demo) ----------
war = [
    ("SDN", "সুদান", [("2024-01-10", "বাহিনী ক", 120), ("2024-04-02", "বিরোধপূর্ণ", 340), ("2024-08-15", "বাহিনী খ", 210)]),
    ("SDS", "দক্ষিণ সুদান", [("2024-02-01", "বাহিনী খ", 40), ("2024-06-20", "বাহিনী খ", 65)]),
    ("TCD", "চাদ", [("2024-03-12", "বাহিনী ক", 25)]),
    ("ETH", "ইথিওপিয়া", [("2024-01-25", "বাহিনী গ", 90), ("2024-07-01", "বিরোধপূর্ণ", 150)]),
    ("CAF", "মধ্য আফ্রিকান প্রজাতন্ত্র", [("2024-05-05", "বাহিনী ক", 30)]),
]
for code, region, events in war:
    c.execute("INSERT INTO ConflictZones (RegionName, SvgPathId) VALUES (?,?)", (region, code))
    zone_id = c.lastrowid
    for when, force, casualties in events:
        c.execute("INSERT INTO TimelineEvents (ConflictZoneId, Date, ControllingForce, Casualties, Description) VALUES (?,?,?,?,?)",
                  (zone_id, when, force, casualties, f"ডেমো তথ্য — {force} এর নিয়ন্ত্রণ পরিবর্তন।"))

# ---------- budget ----------
sectors = [
    ("শিক্ষা", 94_711, [("ডেমো: ডিজিটাল শ্রেণিকক্ষ প্রকল্প", 5_200, 44, "23.81,90.41")]),
    ("পরিবহন ও যোগাযোগ", 82_431, [("ডেমো: মেট্রোরেল লাইন ক", 22_000, 91, "23.81,90.37"),
                                ("ডেমো: নদী টানেল প্রকল্প", 10_500, 100, "22.23,91.82"),
                                ("ডেমো: রেল সংযোগ প্রকল্প", 39_000, 78, "23.44,90.26")]),
    ("বিদ্যুৎ ও জ্বালানি", 35_600, [("ডেমো: পারমাণবিক বিদ্যুৎকেন্দ্র", 28_000, 62, "24.07,89.05")]),
    ("স্বাস্থ্য", 41_408, [("ডেমো: বিশেষায়িত হাসপাতাল", 6_000, 40, "23.75,90.39")]),
    ("কৃষি", 33_000, []),
    ("সামাজিক নিরাপত্তা", 30_000, []),
    ("প্রতিরক্ষা", 29_000, []),
    ("স্থানীয় সরকার", 27_000, [("ডেমো: গ্রামীণ সড়ক উন্নয়ন", 4_000, 55, "")]),
    ("জনশৃঙ্খলা ও নিরাপত্তা", 22_000, []),
]
for sector, allocation, projects in sectors:
    c.execute("INSERT INTO BudgetSectors (Name, TotalAllocation, FiscalYear) VALUES (?,?,?)", (sector, allocation, "2025-26"))
    sector_id = c.lastrowid
    for pname, amount, completion, loc in projects:
        c.execute("INSERT INTO MegaProjects (Name, BudgetSectorId, BudgetAmount, CompletionPercentage, GeoLocation) VALUES (?,?,?,?,?)",
                  (pname, sector_id, amount, completion, loc))

con.commit()
con.close()
print(f"Demo data seeded: {seat_count} seats in {len(districts)} districts, 3 matches (football, cricket, kabaddi), "
      f"{len(war)} conflict zones, {len(sectors)} budget sectors.")
