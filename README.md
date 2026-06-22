# ✈ Focus Flying — Local Flight Tracker

A polished, **static** web app that lets you pick an airport on a world
map, browse its departing flights, choose one to follow, wait for it to
take off, and then **watch it fly across the map in real time** — with
optional terminal/cabin ambience that follows the flight phase.

It runs **entirely in the browser** with no backend. Open it via any
static file server (e.g. Python's `http.server`) and it works immediately
in a realistic, simulation-first **demo mode**.

---

## Quick start

```bash
cd VIBE-Focus-Flying-app
python -m http.server 8082
```

Then open:

```
http://localhost:8082
```

> **Why a server and not `file://`?** The app uses native ES modules and
> `fetch()` for the JSON data files. Browsers block both over `file://`,
> so it must be served over `http`. Any static server works
> (`npx serve`, `php -S`, VS Code Live Server, etc.).

---

## How to use it

1. **Choose an airport** — click any blue pin on the map, or use the
   search box (name, city, IATA, or ICAO, e.g. `JFK`, `LHR`, `Tokyo`).
2. **Browse departures** — the sidebar fills with departing flights
   (airline, aircraft, destination, terminal/gate, distance).
3. **Pick a flight** — its phase tracker appears:
   `Scheduled → Boarding → Taxiing → Takeoff → Airborne`, with a live
   countdown to takeoff.
4. **Wait for takeoff** — when the flight goes airborne the app
   **automatically switches to tracking mode**: it draws the great-circle
   route, drops an aircraft marker, and follows it across the map.
5. **Track it** — the HUD and sidebar show flight number, origin,
   destination, altitude, ground speed, heading, progress, and last
   update time. Toggle **Follow** to lock/unlock the camera.
6. **(Optional) Audio** — click the speaker icon to enable ambience.
   Terminal ambience before takeoff, cabin ambience once airborne.

---

## Architecture

The code is modular ES modules, one responsibility per file:

```
config.js          → all swappable settings (mode, API, timing, audio)
app.js             → orchestrator: wires modules + owns the user flow
js/
  airports.js      → AirportService: load + search the airport dataset
  flights.js       → FlightService: build the departure board (demo/live)
  flightState.js   → FlightStateMachine: phase timing & transitions
  tracking.js      → Tracker: airborne position stream (sim or live API)
  map.js           → MapController: all Leaflet rendering
  audio.js         → AudioController: phase-aware optional ambience
  ui.js            → UIController: all non-map DOM rendering
  geo.js           → great-circle math (distance/bearing/interpolation)
  util.js          → small shared helpers (RNG, formatting, debounce)
```

Data flow (events, not tight coupling):

```
selectAirport → FlightService.getDepartures → render list
selectFlight  → FlightStateMachine.start
                   ├─ "phase"    → UI stepper + status + audio
                   ├─ "countdown"→ UI countdown
                   └─ "airborne" → MapController.showRoute + Tracker.start
                                        └─ "update" → map marker + HUD + readout
                                        └─ "arrived"→ summary + toast
```

### Chosen libraries

- **[Leaflet 1.9](https://leafletjs.com/)** for the map — tiny, dependency-free,
  excellent for marker/polyline work. Loaded from CDN with SRI hashes.
- **CARTO dark basemap** tiles (free, attributed) for a clean look.
- **No build step, no framework.** Vanilla ES modules keep the project
  trivially serveable as static files.

---

## Demo mode vs Live mode

Set the mode in [`config.js`](config.js): `mode: "live"` (default, real-time
ADS-B) or `mode: "demo"` (fully offline simulation).

### Demo mode (default, fully offline)

- **Departures** are generated deterministically per airport from the
  bundled airline/aircraft/route dataset (`data/sample-flights.json`),
  so the same airport shows a stable, realistic board.
- **Phases** advance on time-compressed timers (configurable under
  `sim.phaseDurations`), so you reach takeoff in well under a minute.
- **Flight** is animated along the real great-circle path with a
  climb → cruise → descent altitude/speed profile, compressed by
  `sim.timeCompression` so even long-haul legs finish in ~1–2 minutes.

### Live mode (genuinely real-time, no backend)

Set `mode: "live"` in `config.js` (this is the default). The bundled live
adapter uses **[airplanes.live](https://airplanes.live/)** — a free,
keyless community ADS-B network that serves `Access-Control-Allow-Origin: *`,
so the **static site calls it directly from the browser with no proxy and
no backend**.

What changes in live mode:

- **"Departures" become live traffic near the airport.** Selecting an
  airport queries real aircraft within `live.searchRadiusNm` nautical miles
  and lists them, ranked so genuine departures (on the ground / taxiing /
  climbing out nearby) appear first. Each card shows the real callsign,
  type, registration, status, altitude/speed, and distance.
- **Selecting one tracks it for real**, polling `…/v2/hex/{hex}` every
  `livePollIntervalMs` (default 5 s). The marker, HUD, and readouts update
  from real ADS-B telemetry: position, altitude, ground speed, track, and
  vertical speed.
- **You really wait for takeoff.** Pick an aircraft still on the ground and
  the phase is driven by live telemetry (`scheduled → taxi → takeoff →
  airborne`); the moment it lifts off you watch it climb out and fly. Pick
  an airborne aircraft and it tracks immediately. When an airborne aircraft
  settles back onto the ground, it's reported as arrived.

**Honest limitation:** ADS-B carries *no scheduled destination*, so live
mode shows live telemetry plus the **flown trail** rather than a fixed
origin → destination route line and percentage progress. (Demo mode has a
known destination, so it shows the full route and progress.)

- `fallbackToDemoOnError: true` drops to the simulated board only if the
  live **request fails** (network/offline). An *empty* live result is shown
  as "no live traffic right now" rather than faking data.
- **OpenSky** credentials are still present in `config.js`, but OpenSky does
  **not** send permissive CORS headers, so calling it from a browser
  requires a proxy. To use it, run a small local CORS proxy and point
  `live.opensky.statesUrl` at it, then re-enable its branch.
- To integrate another provider (AviationStack, FlightAware AeroAPI, …):
  implement `FlightService._fetchLiveDepartures()` in `js/flights.js` and
  `Tracker._startLivePolling()` in `js/tracking.js`.

#### "`.env`" equivalent

There are no secrets in the repo. All configuration — including any API
keys — lives in `config.js`. For local overrides without touching the
tracked file, create `config.local.js` (git-ignored) and load it after
`config.js`, or simply edit `config.js` directly. Example values to set
for live mode:

```js
// config.js
mode: "live",
live: {
  provider: "opensky",
  opensky: { statesUrl: "...", username: "YOUR_USER", password: "YOUR_PASS" }
}
```

---

## Configuration cheatsheet (`config.js`)

| Key                          | Meaning                                             |
| ---------------------------- | --------------------------------------------------- |
| `mode`                       | `"demo"` or `"live"`                                |
| `fallbackToDemoOnError`      | Auto-fallback to demo if live fails                 |
| `live.opensky.*`             | OpenSky endpoint + optional basic auth              |
| `livePollIntervalMs`         | Live position poll cadence                          |
| `staleAfterMs`               | When to flag live data as stale                     |
| `sim.phaseDurations`         | Real ms for scheduled/boarding/taxi/takeoff         |
| `sim.timeCompression`        | Simulated seconds per real second while airborne    |
| `sim.departuresPerAirport`   | How many departures to generate                     |
| `audio.airportSrc/cabinSrc`  | Ambience file paths                                 |
| `map.*`                      | Initial center/zoom, tile layer                     |

---

## Audio

Optional and respectful of browser autoplay rules — nothing plays until
you click the unmute button (a user gesture). Add two looping files:

- `assets/audio/airport.mp3` — terminal ambience (pre-takeoff)
- `assets/audio/cabin.mp3` — cabin ambience (airborne)

See [`assets/audio/README.md`](assets/audio/README.md). The app works
fine without them; it just reports `Audio: (no file)`.

---

## Project structure

```
VIBE-Focus-Flying-app/
├── index.html
├── styles.css
├── config.js
├── app.js
├── js/
│   ├── airports.js
│   ├── flights.js
│   ├── flightState.js
│   ├── tracking.js
│   ├── map.js
│   ├── audio.js
│   ├── ui.js
│   ├── geo.js
│   └── util.js
├── data/
│   ├── airports.json          # 44 major world airports
│   └── sample-flights.json    # airlines, aircraft, curated routes
├── assets/
│   └── audio/
│       └── README.md          # how to add ambience (files git-ignored)
└── README.md
```

---

## Error handling

The app handles each of these gracefully (status bar + toast):

- **No airport selected** → friendly hint in the sidebar.
- **No departures found** → empty state with a refresh button.
- **Flight not yet airborne** → phase tracker + countdown, no map marker yet.
- **Tracking data unavailable / stale** → keeps last known position, flags "stale".
- **API key missing / live failure** → auto-fallback to demo (configurable).
- **Network / data load failure** → clear error message (e.g. "serve over http").
- **Audio autoplay blocked** → audio only starts on the unmute click; no errors.
- **Map/CDN unreachable** → status + toast explaining Leaflet couldn't load.

---

## Limitations & future improvements

- **Live departure boards** require a paid/keyed API; the hook is in place
  (`FlightService._fetchLiveDepartures`) but ships synthesized for offline use.
- Aircraft motion is a smooth great-circle interpolation, not a replay of
  real ADS-B tracks (in demo mode), and ignores winds/airways.
- A small built-in airport set (44 hubs) keeps the download tiny; swap in a
  larger dataset by replacing `data/airports.json` (same shape).
- Possible next steps: multi-flight tracking, weather overlay, real airline
  logos, replaying historical OpenSky tracks, and persisting the last
  selected airport in `localStorage`.

---

## License / attribution

- Map tiles © OpenStreetMap contributors, © CARTO.
- Airport/airline/aircraft data in `data/` is a small hand-curated demo set.
- Bring your own audio assets (see notes above).
