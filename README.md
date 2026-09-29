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
- **Control room** (`/admin-dashboard.html`) — Bangla dashboard to switch what's on air, enter
  live data, and watch a live preview of the wall.

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

- Wall: http://localhost:8080/magic-wall.html
- Control room: http://localhost:8080/admin-dashboard.html (paste the admin key)

Optional demo data (fictional parties and figures, for rehearsal only):

```bash
docker run --rm --user 1654 -v magicwall_magicwall-data:/data -v "$PWD/tools:/tools:ro" \
  python:3.13-slim python /tools/seed_demo.py --db /data/magicwall.db
```

## Run it (without Docker)

```bash
cd src/MagicWall.Api
dotnet run --launch-profile http      # http://localhost:5080, admin key: dev-admin-key
```

## Project layout

| Path | What |
|---|---|
| `src/MagicWall.Api/Modules/` | One folder per module: entities, EF configuration, endpoints |
| `src/MagicWall.Api/Wall/` | On-air state, SignalR events, admin-key filter |
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
