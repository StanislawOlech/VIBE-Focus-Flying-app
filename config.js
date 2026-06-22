/**
 * config.js
 * -------------------------------------------------------------
 * Central, swappable configuration for the Focus Flying app.
 *
 * This file is intentionally framework-free and isolates anything
 * that an integrator might want to change (API keys, endpoints,
 * polling intervals, simulation timing). Treat it like a `.env`:
 * copy/edit values here, do NOT hardcode secrets elsewhere.
 *
 * MODES
 *  - "demo": fully offline, simulation-first. No network needed.
 *  - "live": attempts to use a real flight-data API. Falls back to
 *            demo automatically if the API is missing/unreachable.
 *
 * To run live mode you must supply a working provider below. The
 * default ships in demo mode so the app works immediately.
 */
window.APP_CONFIG = {
  // "demo" | "live"
  mode: "live",

  // If live mode fails (no key, network error, CORS), drop to demo.
  fallbackToDemoOnError: true,

  // -----------------------------------------------------------
  // Live data provider configuration.
  // Default provider is airplanes.live — a free, keyless, community
  // ADS-B network that (crucially) serves `Access-Control-Allow-Origin: *`,
  // so a purely static site can call it directly from the browser with
  // NO backend and NO proxy. It returns genuinely real-time aircraft:
  // position, altitude, ground speed, track, vertical rate, on-ground.
  //
  // What live mode does:
  //   • "Departures" become LIVE TRAFFIC near the chosen airport — real
  //     aircraft on the ground / taxiing / departing / overhead.
  //   • Selecting one polls it by transponder hex for real-time motion.
  //   • Pick an aircraft still on the ground and you genuinely wait for
  //     it to take off (telemetry-driven phase), then watch it fly.
  //
  // Limitation: ADS-B has no scheduled DESTINATION, so live mode shows
  // live telemetry + a flown trail rather than a fixed origin→dest route.
  //
  // OpenSky is kept as an alternative provider, but it does NOT send
  // permissive CORS headers, so from a browser it requires a proxy
  // (e.g. run a small local CORS proxy and point statesUrl at it).
  // -----------------------------------------------------------
  live: {
    provider: "airplaneslive", // "airplaneslive" | "opensky" | "custom"

    // Search radius (nautical miles) for "live traffic near airport".
    searchRadiusNm: 60,

    airplaneslive: {
      pointUrl: "https://api.airplanes.live/v2/point", // {lat}/{lon}/{distNm}
      hexUrl: "https://api.airplanes.live/v2/hex" // {hex}
    },

    opensky: {
      statesUrl: "https://opensky-network.org/api/states/all",
      // Optional basic-auth (raises rate limits). Leave blank for anonymous.
      // NOTE: browser CORS will block this unless proxied.
      // SECRETS: do NOT put real credentials here. Copy config.local.example.js
      // to config.local.js (gitignored) and set them there instead.
      username: "",
      password: ""
    },

    // Generic placeholder for your own API. Wire it up in js/flights.js.
    custom: {
      baseUrl: "",
      apiKey: ""
    }
  },

  // How often (ms) to poll live position data while tracking.
  // airplanes.live asks for <= 1 request/second; 5s is polite + lively.
  livePollIntervalMs: 5000,

  // Consider a live position "stale" after this many ms with no update.
  staleAfterMs: 30000,

  // -----------------------------------------------------------
  // Simulation timing. All durations are in REAL milliseconds.
  // The demo is time-compressed so a full flight phase cycle is
  // watchable in a minute or two. Tweak freely.
  // -----------------------------------------------------------
  sim: {
    // Phase durations before takeoff (ms of real time).
    phaseDurations: {
      scheduled: 6000, // sitting at gate, pre-boarding
      boarding: 9000,
      taxi: 7000,
      takeoff: 5000 // takeoff roll + initial climb
    },
    // Randomness applied to each phase duration (+/- fraction).
    phaseJitter: 0.35,

    // Position update cadence once airborne (ms).
    tickMs: 1000,

    // Time compression for the airborne leg: how many simulated
    // seconds pass per real second. Higher = aircraft moves faster.
    timeCompression: 120,

    // Number of departure candidates to generate per airport.
    departuresPerAirport: 9,

    // Climb/descent profile (feet) used for altitude readout.
    climbToCruiseSec: 1100, // simulated seconds to reach cruise alt
    descentStartFraction: 0.86 // begin descent at this fraction of route
  },

  // -----------------------------------------------------------
  // Audio assets. Files are optional — if absent, the UI still
  // works and simply reports that audio is unavailable.
  // -----------------------------------------------------------
  audio: {
    airportSrc: "assets/audio/airport.mp3",
    cabinSrc: "assets/audio/cabin.mp3",
    defaultVolume: 0.5,
    startMuted: true
  },

  // Map defaults.
  map: {
    initialCenter: [25, 10],
    initialZoom: 2.4,
    minZoom: 2,
    maxZoom: 12,
    tileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    tileAttribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }
};
