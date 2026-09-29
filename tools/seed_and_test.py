#!/usr/bin/env python3
"""Seed a fresh Magic Wall database and smoke-test the Phase 2 API.

Stdlib only. Run it on the machine (or WSL distro) that holds the .db file,
while the API is running in Development mode:

    python3 tools/seed_and_test.py
    python3 tools/seed_and_test.py --db /path/to/magicwall.db --base-url http://localhost:5080

The script refuses to seed a database that already contains data.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

RECORD_SEPARATOR = "\x1e"  # SignalR JSON protocol message terminator

here = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument("--db", default=os.path.join(here, "..", "src", "MagicWall.Api", "magicwall.db"))
parser.add_argument("--base-url", default="http://localhost:5080")
args = parser.parse_args()
base = args.base_url.rstrip("/")
db_path = os.path.abspath(args.db)


def request(path, method="GET", body=None, timeout=30):
    data = body.encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 1. Wait for the API (which also creates the schema by applying migrations on startup).
print(f"API: {base}\nDB:  {db_path}\n")
for _ in range(30):
    try:
        request("/api/budget/sectors", timeout=2)
        break
    except Exception:
        time.sleep(1)
else:
    sys.exit(f"API not reachable at {base}. Is it running (dotnet run --launch-profile http)?")

if not os.path.exists(db_path):
    sys.exit(f"Database not found at {db_path}. Pass --db with the path the API is using.")

# 2. Seed.
con = sqlite3.connect(db_path)
c = con.cursor()
if c.execute("SELECT COUNT(*) FROM Constituencies").fetchone()[0] > 0:
    sys.exit("Database already has data. Stop the API, delete the .db file, restart the API, then rerun.")

c.execute("INSERT INTO Constituencies (Id, Name, SvgPathId, TotalVoters) VALUES (1,'Dhaka-10','dhaka-10',1000)")
c.execute("INSERT INTO Candidates (Id, Name, PartyName, Symbol) VALUES (1,'Alpha','Party A','Boat'),(2,'Beta','Party B','Sheaf')")
c.execute("INSERT INTO ElectionResults (ConstituencyId, CandidateId, VotesReceived) VALUES (1,1,200),(1,2,400)")
c.execute("INSERT INTO Matches (Id, Title, Sport, MatchDate, TeamA, TeamB) VALUES (1,'Final','Football','2026-09-01 18:00:00','A','B')")
c.execute("INSERT INTO Players (Id, Name, Team, Role) VALUES (1,'Striker One','A','Striker'),(2,'Bench','A','Keeper')")
c.execute("INSERT INTO MatchEvents (MatchId, PlayerId, EventType, CoordinateX, CoordinateY, EndCoordinateX, EndCoordinateY, Minute) VALUES "
          "(1,1,'Goal',90,50,NULL,NULL,70),(1,1,'Pass',40,30,60,45,12)")
c.execute("INSERT INTO ConflictZones (Id, RegionName, SvgPathId) VALUES (1,'North Sector','north')")
c.execute("INSERT INTO TimelineEvents (ConflictZoneId, Date, ControllingForce, Casualties, Description) VALUES "
          "(1,'2024-01-01','Force X',10,'Start'),(1,'2024-03-01','Force Y',5,'Captured'),(1,'2024-06-01','Force X',7,'Retaken')")
c.execute("INSERT INTO BudgetSectors (Id, Name, TotalAllocation, FiscalYear) VALUES "
          "(1,'Transport',1000,'2025-26'),(2,'Health',2000,'2025-26'),(3,'Old',50,'2024-25')")
c.execute("INSERT INTO MegaProjects (Name, BudgetSectorId, BudgetAmount, CompletionPercentage, GeoLocation) VALUES "
          "('Small',1,100,20,'23.8,90.4'),('Big',1,500,80,'22.3,91.8')")
con.commit()
con.close()
print("Seeded sample data.\n")

# 3. Endpoint checks: (path, expected status, assertion on parsed JSON or None).
failures = 0


def check(name, path, expected_status, assertion=None):
    global failures
    status, body = request(path)
    ok = status == expected_status
    detail = f"status {status}"
    if ok and assertion is not None:
        try:
            assertion(json.loads(body))
        except AssertionError as e:
            ok, detail = False, f"assertion failed: {e}"
    print(f"{'PASS' if ok else 'FAIL'}  {name}  ({detail})")
    if not ok:
        failures += 1
        print("      body:", body[:500])


def assert_equal(a, b):
    assert a == b, f"{a} != {b}"


def no_events(d):
    assert d["events"] == [], d["events"]


def election_ok(d):
    assert d["totalVotesCast"] == 600, d["totalVotesCast"]
    assert d["turnoutPercentage"] == 60, d["turnoutPercentage"]
    assert [r["candidateName"] for r in d["results"]] == ["Beta", "Alpha"], "not ordered by votes desc"
    assert d["results"][0]["voteSharePercentage"] == 66.67, d["results"][0]["voteSharePercentage"]


def sports_ok(d):
    assert d["sport"] == "Football", f"sport={d['sport']!r} (enum should serialize as name)"
    assert [e["minute"] for e in d["events"]] == [12, 70], "not ordered by minute"
    assert d["events"][0]["eventType"] == "Pass", d["events"][0]["eventType"]
    assert d["events"][0]["endX"] == 60, "arrow end point missing"


def war_mid_ok(d):
    assert len(d["events"]) == 2, f"{len(d['events'])} events, expected 2 up to 2024-04-15"
    assert d["currentControllingForce"] == "Force Y", d["currentControllingForce"]
    assert d["cumulativeCasualties"] == 15, d["cumulativeCasualties"]


def war_before_ok(d):
    assert d["events"] == [] and d["currentControllingForce"] is None, d


def budget_all_ok(d):
    assert [s["name"] for s in d] == ["Health", "Transport", "Old"], "not ordered by allocation desc"
    transport = d[1]
    assert [p["name"] for p in transport["megaProjects"]] == ["Big", "Small"], "projects not ordered by amount desc"
    assert transport["megaProjectsTotal"] == 600, transport["megaProjectsTotal"]


check("Election: results by SvgPathId", "/api/election/results/dhaka-10", 200, election_ok)
check("Election: unknown SvgPathId -> 404", "/api/election/results/nope", 404)
check("Sports: player events", "/api/sports/events/1/1", 200, sports_ok)
check("Sports: player with no events -> empty list", "/api/sports/events/1/2", 200, no_events)
check("Sports: unknown match -> 404", "/api/sports/events/99/1", 404)
check("War: timeline up to date (case-insensitive region)", "/api/war/timeline/north%20sector/2024-04-15", 200, war_mid_ok)
check("War: date before first event", "/api/war/timeline/North%20Sector/2023-01-01", 200, war_before_ok)
check("War: unknown region -> 404", "/api/war/timeline/Nowhere/2024-04-15", 404)
check("War: invalid date -> 400", "/api/war/timeline/North%20Sector/not-a-date", 400)
check("Budget: all sectors with projects", "/api/budget/sectors", 200, budget_all_ok)
check("Budget: fiscalYear filter", "/api/budget/sectors?fiscalYear=2024-25", 200,
      lambda d: assert_equal([s["name"] for s in d], ["Old"]))


# 4. SignalR handshake over long polling (no WebSocket library needed).
def signalr_handshake():
    status, body = request("/hubs/magicwall/negotiate?negotiateVersion=1", "POST", "")
    assert status == 200, f"negotiate status {status}"
    token = json.loads(body)["connectionToken"]
    hub = f"/hubs/magicwall?id={token}"

    status, _ = request(hub)  # first poll just activates the connection
    assert status == 200, f"initial poll status {status}"

    status, _ = request(hub, "POST", json.dumps({"protocol": "json", "version": 1}) + RECORD_SEPARATOR)
    assert status == 200, f"handshake send status {status}"

    status, body = request(hub)
    assert status == 200, f"handshake poll status {status}"
    assert body.startswith("{}" + RECORD_SEPARATOR), f"unexpected handshake response {body!r}"

    request(hub, "DELETE")


try:
    signalr_handshake()
    print("PASS  SignalR: negotiate + JSON protocol handshake")
except Exception as e:
    failures += 1
    print(f"FAIL  SignalR: {e}")

print(f"\n{'ALL PASSED' if failures == 0 else f'{failures} FAILED'}")
sys.exit(1 if failures else 0)
