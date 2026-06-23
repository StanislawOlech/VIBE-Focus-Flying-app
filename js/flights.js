/**
 * flights.js — FlightService
 *
 * Responsible for producing the list of departing flights for a given
 * airport. Two strategies live behind one interface:
 *
 *   DEMO  → deterministic, realistic synthetic departures generated
 *           from the bundled airline/aircraft/route dataset. Always
 *           works offline.
 *
 *   LIVE  → see note in config.js. Public keyless APIs don't reliably
 *           expose scheduled-departure lists, so we still synthesize
 *           the departure board but flag the app as "live" and let the
 *           tracking layer pull real positions where possible. The
 *           method is structured so a real provider can be dropped in
 *           by replacing `_fetchLiveDepartures`.
 *
 * Returned flight objects are plain data; state/animation is handled
 * elsewhere (flightState.js, tracking.js).
 */

import { makeRng, hashCode, pick, randInt, jitter, ktToKmh } from "./util.js";
import { distanceKm } from "./geo.js";

export class FlightService {
  /**
   * @param {object} cfg  window.APP_CONFIG
   * @param {AirportService} airportService
   */
  constructor(cfg, airportService) {
    this.cfg = cfg;
    this.airports = airportService;
    this.dataset = null;
  }

  async load(url = "data/sample-flights.json") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load flight dataset (${res.status})`);
    this.dataset = await res.json();
    return this.dataset;
  }

  /**
   * Get departures for an airport. Always resolves to an array; never
   * throws for "no data" — returns [] so the UI can show an empty state.
   *
   * In LIVE mode this returns REAL aircraft near the airport (and the
   * returned array carries `.live = true`). It only falls back to the
   * demo generator if the live request actually fails (and fallback is
   * enabled) — an empty live result is returned as-is so the UI can say
   * "no live traffic right now" instead of faking data.
   */
  async getDepartures(airport) {
    if (this.cfg.mode === "live") {
      try {
        const live = await this._fetchLiveDepartures(airport);
        live.live = true;
        return live;
      } catch (err) {
        if (!this.cfg.fallbackToDemoOnError) throw err;
        console.warn("[FlightService] live request failed, using demo:", err);
        const demo = this._generateDepartures(airport);
        demo.liveFailed = true;
        return demo;
      }
    }
    return this._generateDepartures(airport);
  }

  /* ----------------------------------------------------------------
   * LIVE adapter — real-time traffic near the airport.
   * Default provider: airplanes.live (keyless, CORS-friendly).
   * ---------------------------------------------------------------- */
  async _fetchLiveDepartures(airport) {
    const lv = this.cfg.live;
    if (lv.provider !== "airplaneslive") {
      // Other providers (e.g. OpenSky) typically need a proxy from the
      // browser; surface that clearly rather than failing silently.
      throw new Error(
        `Live provider "${lv.provider}" is not browser-callable here. Use "airplaneslive" or add a proxy.`
      );
    }

    const r = lv.searchRadiusNm;
    const url = `${lv.airplaneslive.pointUrl}/${airport.lat}/${airport.lon}/${r}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`airplanes.live ${res.status}`);
    const data = await res.json();
    const ac = Array.isArray(data.ac) ? data.ac : [];

    const flights = ac
      .filter((a) => a.lat != null && a.lon != null)
      .map((a) => this._liveFlightFromAircraft(a, airport))
      .filter(Boolean);

    // Rank: things actually leaving this airport first (on ground /
    // taxiing / climbing nearby), then by proximity.
    flights.sort((a, b) => b._score - a._score || a._distNm - b._distNm);
    return flights.slice(0, 24);
  }

  _liveFlightFromAircraft(a, airport) {
    const onGround = a.alt_baro === "ground";
    const alt = onGround ? 0 : typeof a.alt_baro === "number" ? a.alt_baro : 0;
    const spd = Math.round(a.gs || 0);
    const heading = a.track ?? a.true_heading ?? a.mag_heading ?? 0;
    const rate = a.baro_rate ?? a.geom_rate ?? 0;
    const distNm = typeof a.dst === "number" ? a.dst : null;
    const callsign = (a.flight || "").trim();
    const label = (callsign || a.r || a.hex || "").trim();
    const status = classifyLive(onGround, alt, rate, spd);

    return {
      id: a.hex,
      icao24: a.hex,
      flightNumber: label,
      callsign,
      airline: { name: (a.ownOp || "").trim() || "Unknown operator", iata: "", icao: "" },
      origin: airport,
      destination: null, // ADS-B does not carry scheduled destination
      aircraft: {
        type: (a.desc || a.t || "Unknown aircraft").trim(),
        code: (a.t || "").trim(),
        cruiseSpeedKt: spd,
        cruiseAltFt: alt
      },
      registration: (a.r || "").trim(),
      terminal: "—",
      gate: "—",
      scheduledDep: null,
      distanceKm: null,
      live: true,
      liveStatus: status,
      _distNm: distNm ?? 9999,
      _score: scoreDeparting(onGround, alt, rate, distNm),
      snapshot: {
        lat: a.lat,
        lon: a.lon,
        altitudeFt: alt,
        speedKt: spd,
        heading,
        verticalRate: rate,
        onGround,
        distNm,
        timestamp: Date.now()
      }
    };
  }

  /* ----------------------------------------------------------------
   * DEMO generator — deterministic per airport (stable across reloads).
   * ---------------------------------------------------------------- */
  _generateDepartures(airport) {
    const ds = this.dataset;
    const seed = hashCode(airport.icao + new Date().toDateString());
    const rng = makeRng(seed);

    // Candidate destinations: curated route if present, else nearest-ish
    // sampling of the dataset (excluding the origin).
    let destCodes = [];
    const curated = ds.curatedRoutes.find((r) => r.origin === airport.iata);
    if (curated) destCodes = [...curated.destinations];

    const allOthers = this.airports.airports
      .filter((a) => a.iata !== airport.iata)
      .map((a) => a.iata);

    // Top up with random destinations until we have enough variety.
    while (destCodes.length < this.cfg.sim.departuresPerAirport + 3) {
      const c = pick(rng, allOthers);
      if (!destCodes.includes(c)) destCodes.push(c);
    }

    const count = this.cfg.sim.departuresPerAirport;
    const now = Date.now();
    const flights = [];
    const usedNumbers = new Set();

    for (let i = 0; i < count; i++) {
      const destCode = destCodes[i % destCodes.length];
      const destination = this.airports.get(destCode);
      if (!destination) continue;

      const airline = pick(rng, ds.airlines);
      const aircraft = this._pickAircraftForRange(rng, ds, distanceKm(airport, destination));

      // Unique-ish flight number per airline.
      let fnum;
      do {
        fnum = randInt(rng, 100, 2999);
      } while (usedNumbers.has(airline.iata + fnum));
      usedNumbers.add(airline.iata + fnum);

      // Scheduled departure: staggered a few minutes apart from "now".
      const offsetMin = randInt(rng, 1, 8) + i * randInt(rng, 2, 6);
      const scheduledDep = new Date(now + offsetMin * 60000);

      flights.push({
        id: `${airline.iata}${fnum}-${airport.iata}-${destCode}`,
        flightNumber: `${airline.iata}${fnum}`,
        callsign: `${airline.callsign} ${fnum}`,
        airline,
        origin: airport,
        destination,
        aircraft,
        terminal: pick(rng, ds.terminals),
        gate: `${pick(rng, ["A", "B", "C", "D"])}${randInt(rng, 1, 38)}`,
        scheduledDep,
        distanceKm: Math.round(distanceKm(airport, destination)),
        source: this.cfg.mode === "live" ? "live-board-unavailable" : "demo"
      });
    }

    flights.sort((a, b) => a.scheduledDep - b.scheduledDep);
    return flights;
  }

  /** Choose a plausible aircraft for the route length. */
  _pickAircraftForRange(rng, ds, km) {
    let pool;
    if (km > 6500) {
      pool = ds.aircraft.filter((a) =>
        ["A359", "A388", "B789", "B77W", "B748", "A333"].includes(a.code)
      );
    } else if (km > 2500) {
      pool = ds.aircraft.filter((a) =>
        ["A321", "A333", "B789", "B738", "A20N"].includes(a.code)
      );
    } else {
      pool = ds.aircraft.filter((a) =>
        ["A20N", "A321", "B738", "B38M"].includes(a.code)
      );
    }
    if (!pool.length) pool = ds.aircraft;
    return jitterAircraft(rng, pick(rng, pool));
  }
}

/** Human status for a live aircraft from its telemetry. */
export function classifyLive(onGround, altFt, rateFpm, spdKt) {
  if (onGround) return spdKt >= 5 ? "Taxiing" : "On ground";
  if (altFt < 8000 && rateFpm > 150) return "Departing";
  if (altFt < 9000 && rateFpm < -150) return "Arriving";
  return "Airborne";
}

/**
 * Higher score = more likely to be DEPARTING this airport, so it sorts
 * to the top of the "live traffic" list. On-ground + climbing-nearby win.
 */
function scoreDeparting(onGround, altFt, rateFpm, distNm) {
  const near = distNm == null ? 0 : distNm;
  if (onGround) return near < 6 ? 100 : 70;
  if (altFt < 8000 && rateFpm > 150) return near < 25 ? 90 : 60; // climbing out
  if (altFt < 9000 && rateFpm < -150) return 20; // arriving
  return 40 - Math.min(39, near); // overhead/cruising, prefer closer
}

/* ----------------------------------------------------------------
 * Route lookup. Live ADS-B carries no scheduled destination, so we
 * resolve the real origin → destination route by callsign using the
 * community adsbdb.com API (keyless, CORS-enabled). Lookups are cached
 * per callsign for the session and fail soft (resolve to null) so the
 * UI can show "destination unknown" rather than breaking.
 * ---------------------------------------------------------------- */
const _routeCache = new Map();

export function fetchRoute(callsign) {
  const cs = (callsign || "").trim().toUpperCase();
  if (!cs) return Promise.resolve(null);
  if (_routeCache.has(cs)) return _routeCache.get(cs);

  const p = (async () => {
    try {
      const res = await fetch(
        `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const fr = data && data.response && data.response.flightroute;
      if (!fr || !fr.destination) return null;
      return {
        origin: _routeAirport(fr.origin),
        destination: _routeAirport(fr.destination)
      };
    } catch (err) {
      console.warn("[FlightService] route lookup failed:", err);
      return null;
    }
  })();

  _routeCache.set(cs, p);
  return p;
}

function _routeAirport(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || "",
    icao: a.icao_code || "",
    name: a.name || "",
    city: a.municipality || a.name || a.iata_code || "Unknown",
    country: a.country_name || "",
    lat: a.latitude,
    lon: a.longitude
  };
}

/**
 * Rough arrival-time estimate from the aircraft's current position and
 * ground speed toward a known destination. Uses a nominal cruise speed
 * when the aircraft is slow or still on the ground.
 */
export function estimateArrival(destination, pos) {
  if (!destination || !pos || pos.lat == null || pos.lon == null) return null;
  if (destination.lat == null || destination.lon == null) return null;
  const remainingKm = distanceKm({ lat: pos.lat, lon: pos.lon }, destination);
  const spdKt = pos.speedKt || 0;
  const effKt = spdKt > 150 ? spdKt : 450; // nominal cruise if slow/on ground
  const hours = remainingKm / ktToKmh(effKt);
  return {
    remainingKm: Math.round(remainingKm),
    eta: new Date(Date.now() + hours * 3600 * 1000)
  };
}

/** Slight per-flight variation of cruise figures for realism. */
function jitterAircraft(rng, ac) {
  return {
    ...ac,
    cruiseSpeedKt: Math.round(jitter(rng, ac.cruiseSpeedKt, 0.04)),
    cruiseAltFt: Math.round(jitter(rng, ac.cruiseAltFt, 0.05) / 1000) * 1000
  };
}
