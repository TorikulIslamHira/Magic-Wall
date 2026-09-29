# Vendored front-end libraries

Committed to the repo so the wall and admin dashboard work on air-gapped studio
networks. Nothing is loaded from a CDN at runtime.

| Library | Version | File | License |
|---|---|---|---|
| D3 | 7.9.0 | `d3/d3.min.js` (UMD build, exposes `window.d3`) | ISC (`d3/LICENSE`) |
| ASP.NET Core SignalR client | 8.0.7 | `signalr/signalr.min.js` (exposes `window.signalR`) | MIT (`signalr/LICENSE`) |

## Updating

On a machine with internet access, from `src/MagicWall.Api/wwwroot/lib`:

```bash
curl -fsSL -o d3/d3.min.js https://cdn.jsdelivr.net/npm/d3@<version>/dist/d3.min.js
curl -fsSL -o signalr/signalr.min.js https://cdn.jsdelivr.net/npm/@microsoft/signalr@<version>/dist/browser/signalr.min.js
```

Then update the table above, rebuild the image, and check the Election, War and
Budget views (D3) and the live indicator (SignalR) on the wall.
