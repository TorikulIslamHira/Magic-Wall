# ম্যাজিক ওয়াল · Magic Wall

An interactive "magic wall" for live TV presenters: a touch-screen explainer for elections,
sports, conflicts and the national budget, driven in real time from a producer's control room.

- **Presenter wall** (`/magic-wall.html`) — Bangla, broadcast-style, touch-friendly:
  - **Election:** Bangladesh district map coloured by leading party, seat race bar with the
    majority line, drill-down from nation → district → seat.
  - **Sports:** football/cricket pitch with heatmap, pass/shot arrows and event markers.
  - **War & Geopolitics:** world map with a timeline slider; control and casualties change as
    the presenter scrubs through dates. Contested zones are striped.
  - **Budget:** top-5 sector donut, ranked sector list and mega-project progress.
- **Interactive hub** (`/interactive-hub.html`) — full-screen Bangla menu; the presenter opens any
  module full screen and returns to the menu.
- **Control room** (`/admin-dashboard.html`) — Bangla dashboard with sign-in and roles: field
  reporters submit figures, the desk approves them (maker-checker), the sports desk approves the
  live feed, admins manage users; switch what's on air and watch a live preview of the wall.

Changes reach every screen within a second over SignalR.

## Stack

ASP.NET Core 10 minimal API · EF Core + SQLite (migrations) · SignalR · vanilla JS/CSS · D3 (maps,
donut) · Canvas (pitch). No CDN at runtime: D3, SignalR, the Hind Siliguri font and all map data
are bundled, so it works on an air-gapped studio network.

## Run it (Docker)

```bash
cp .env.example .env          # then set MAGICWALL_ADMIN_KEY (e.g. openssl rand -hex 24)
docker compose up -d --build
```

The app listens on **two ports**, one per audience:

| Port | Who | Serves |
|---|---|---|
| **8080** presenter | studio floor: wall screens, touch displays | `interactive-hub.html` (opens at `/`), `magic-wall.html`, read-only API, live updates. No sign-in, no writes. |
| **8081** admin | control room | `admin-dashboard.html` (opens at `/`), sign-in, approval queues, every write endpoint. |

- Interactive hub: http://localhost:8080/
- Producer-driven wall: http://localhost:8080/magic-wall.html
- Control room: http://localhost:8081/ (sign in; the first admin comes from `MAGICWALL_BOOTSTRAP_PASSWORD`)

On the presenter port everything outside an allow-list answers 404, so the admin page, sign-in and
all writes cannot be reached from the studio floor even with a valid key (see
`src/MagicWall.Api/Hosting/PortIsolation.cs`). Host ports are set in `.env`; an address can be
added, e.g. `MAGICWALL_ADMIN_PORT=127.0.0.1:8081` keeps the control room on this machine only.

Optional demo data (fictional parties and figures, for rehearsal only):

```bash
docker run --rm --user 1654 -v magicwall_magicwall-data:/data -v "$PWD/tools:/tools:ro" \
  python:3.13-slim python /tools/seed_demo.py --db /data/magicwall.db
```

## Live football data (optional)

Set in `.env`, then `docker compose up -d --build`:

```bash
MAGICWALL_SPORTS_PROVIDER=FootballData
MAGICWALL_FOOTBALL_DATA_KEY=<your football-data.org key>
MAGICWALL_FOOTBALL_DATA_RPM=10        # your plan's requests per minute (Free 10, Deep Data 30)
MAGICWALL_THESPORTSDB_KEY=123         # TheSportsDB public test key, or your premium key
```

- **football-data.org** gives fixtures, live status and score. Goal scorers, cards and
  substitutions are only in their paid "Deep Data" plan; on the free plan the scoreboard works and
  the event timeline stays empty.
- The sports desk imports matches in the control room (খেলা → লাইভ সূচি থেকে আমদানি). The score goes
  to the wall straight away; every goal/card/substitution waits in the approval queue.
- **TheSportsDB** supplies player photos and team badges. They are downloaded once and served by this
  server, so the wall never needs the internet. Photos are credited on air ("ছবি: TheSportsDB");
  check both providers' terms for broadcast use.
- Every request waits for a free slot in the provider's per-minute quota; background polling
  always leaves one slot for people in the control room.

## Run it (without Docker)

```bash
cd src/MagicWall.Api
dotnet run --launch-profile http      # presenter http://localhost:5080, admin http://localhost:5081
                                      # Development seeds demo users (password Demo@1234)
```

## Project layout

| Path | What |
|---|---|
| `src/MagicWall.Api/Modules/` | One folder per module: entities, EF configuration, endpoints |
| `src/MagicWall.Api/Wall/` | On-air state, SignalR events |
| `src/MagicWall.Api/Auth/` | Sign-in, roles and capabilities, user management |
| `src/MagicWall.Api/Hosting/` | Presenter / admin port isolation |
| `src/MagicWall.Api/Data/Migrations/` | EF Core migrations (applied on startup) |
| `src/MagicWall.Api/wwwroot/` | Wall, control room, JS views, bundled libs, fonts, maps |
| `tools/` | `seed_and_test.py` (API smoke test), `seed_demo.py` (demo data), district table |

## Before going on air

- Wipe the demo data and enter real data.
- Set real party colours in `wwwroot/config/parties.json`.
- Verify seats per district in `tools/data/bd-districts.csv` against the Election Commission.
- Keep the map attribution visible (district boundaries: BBS / OCHA via geoBoundaries, CC BY 3.0 IGO;
  world map: Natural Earth, public domain). See `wwwroot/maps/README.md`.
- Run a single instance: on-air state is held in memory.
