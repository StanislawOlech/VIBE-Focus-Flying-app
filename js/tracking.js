/**
 * tracking.js — Tracker
 *
 * Drives the airborne phase: produces a stream of position updates
 * (lat, lon, altitude, speed, heading, progress) for the selected
 * flight after takeoff.
 *
 * DEMO  → great-circle interpolation between origin and destination
 *         with a realistic climb / cruise / descent profile. Time is
 *         compressed via cfg.sim.timeCompression so a long-haul leg is
 *         watchable in a couple of minutes.
 *
 * LIVE  → if a flight carries a real `icao24` transponder id, the
 *         tracker polls the OpenSky Network /states/all endpoint and
 *         emits real positions. Synthetic demo flights have no icao24,
 *         so they always use the simulation path. The polling code is
 *         included and labelled so a real provider can be slotted in.
 */

import { interpolate, bearing, distanceKm } from "./geo.js";
import { clamp, ktToKmh } from "./util.js";
import { classifyLive } from "./flights.js";

export class Tracker {
  constructor(flight, cfg) {
    this.flight = flight;
    this.cfg = cfg;
    this._handlers = { update: [], arrived: [], stale: [], phase: [] };
    this._raf = null;
    this._interval = null;
    this._destroyed = false;

    this.origin = { lat: flight.origin.lat, lon: flight.origin.lon };
    this.lastUpdateAt = Date.now();

    // Sim-only geometry (skipped for live flights, which have no
    // known destination — they follow real ADS-B telemetry instead).
    if (flight.destination) {
      this.dest = { lat: flight.destination.lat, lon: flight.destination.lon };
      this.totalKm = distanceKm(this.origin, this.dest);
      const cruiseKmh = ktToKmh(flight.aircraft.cruiseSpeedKt);
      this.totalSimSec =
        (this.totalKm / cruiseKmh) * 3600 + cfg.sim.climbToCruiseSec * 0.9;
      this.simElapsedSec = 0;
    }
  }

  on(event, fn) {
    if (this._handlers[event]) this._handlers[event].push(fn);
    return this;
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach((fn) => fn(...args));
  }

  start() {
    if (this.flight.live && this.flight.icao24) {
      this._startLivePolling();
    } else {
      this._startSimulation();
    }
    return this;
  }

  /** True when this tracker is following real ADS-B data. */
  get isLive() {
    return !!(this.flight.live && this.flight.icao24);
  }

  /* ============================ SIMULATION ============================ */
  _startSimulation() {
    const tickMs = this.cfg.sim.tickMs;
    const compression = this.cfg.sim.timeCompression;

    // Emit one immediately so the marker appears right at takeoff.
    this._simStep(0);

    this._interval = setInterval(() => {
      if (this._destroyed) return;
      this.simElapsedSec += (tickMs / 1000) * compression;
      this._simStep(this.simElapsedSec);
    }, tickMs);
  }

  _simStep(simSec) {
    const f = clamp(simSec / this.totalSimSec, 0, 1);
    const pos = interpolate(this.origin, this.dest, f);

    // Heading: aim at destination from current point (great-circle).
    const hdg = bearing(pos, this.dest);

    // Altitude profile: climb → cruise → descent.
    const alt = this._altitudeFor(f, simSec);

    // Speed profile: slower during climb/descent, cruise in the middle.
    const spd = this._speedFor(f);

    this.lastUpdateAt = Date.now();
    const update = {
      lat: pos.lat,
      lon: pos.lon,
      altitudeFt: alt,
      speedKt: spd,
      heading: hdg,
      progress: f,
      remainingKm: Math.round(this.totalKm * (1 - f)),
      timestamp: this.lastUpdateAt,
      source: "sim",
      stale: false
    };
    this._emit("update", update);

    if (f >= 1) {
      this._stop();
      this._emit("arrived", update);
    }
  }

  _altitudeFor(f, simSec) {
    const cruise = this.flight.aircraft.cruiseAltFt;
    const climbSec = this.cfg.sim.climbToCruiseSec;
    const descentStart = this.cfg.sim.descentStartFraction;

    // Climb phase (by simulated time).
    if (simSec < climbSec) {
      return Math.round((simSec / climbSec) * cruise);
    }
    // Descent phase (by progress fraction).
    if (f > descentStart) {
      const dF = (f - descentStart) / (1 - descentStart);
      return Math.round(cruise * (1 - dF));
    }
    return cruise;
  }

  _speedFor(f) {
    const cruise = this.flight.aircraft.cruiseSpeedKt;
    // Ramp up over first 8% of route, down over last 12%.
    if (f < 0.08) return Math.round(180 + (cruise - 180) * (f / 0.08));
    if (f > 0.92) {
      const dF = (f - 0.92) / 0.08;
      return Math.round(cruise - (cruise - 160) * dF);
    }
    return cruise;
  }

  /* ============================ LIVE POLLING ============================ */
  /**
   * Polls airplanes.live by transponder hex for genuinely real-time
   * telemetry. Emits:
   *   • "phase"   when the derived flight phase changes (e.g. the moment
   *                an on-ground aircraft lifts off → "takeoff"/"airborne")
   *   • "update"  every poll with real position/altitude/speed/heading
   *   • "arrived" when an airborne aircraft settles back onto the ground
   *   • "stale"   when no fresh data arrives within cfg.staleAfterMs
   */
  _startLivePolling() {
    const base = this.cfg.live.airplaneslive.hexUrl;
    const hex = this.flight.icao24.toLowerCase();
    this._phase = null;
    this._wasAirborne = false;
    this._lastAlt = this.flight.snapshot?.altitudeFt ?? 0;

    const poll = async () => {
      if (this._destroyed) return;
      try {
        const res = await fetch(`${base}/${hex}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`airplanes.live ${res.status}`);
        const data = await res.json();
        const a = (Array.isArray(data.ac) ? data.ac : []).find((x) => x.hex === hex) || (data.ac || [])[0];
        if (!a || a.lat == null || a.lon == null) return this._maybeStale();

        const onGround = a.alt_baro === "ground";
        const alt = onGround ? 0 : typeof a.alt_baro === "number" ? a.alt_baro : this._lastAlt;
        this._lastAlt = alt;
        const spd = Math.round(a.gs || 0);
        const hdg = a.track ?? a.true_heading ?? a.mag_heading ?? 0;
        const rate = a.baro_rate ?? a.geom_rate ?? 0;

        this.lastUpdateAt = Date.now();

        // Phase change detection (drives the stepper + ambience).
        const phase = this._derivePhase(onGround, alt, rate, spd);
        if (phase !== this._phase) {
          this._phase = phase;
          this._emit("phase", phase);
        }

        const pos = {
          lat: a.lat,
          lon: a.lon,
          altitudeFt: alt,
          speedKt: spd,
          heading: hdg,
          verticalRate: rate,
          onGround,
          status: classifyLive(onGround, alt, rate, spd),
          progress: null, // unknown destination in ADS-B
          remainingKm: null,
          timestamp: this.lastUpdateAt,
          source: "live",
          stale: false
        };
        this._emit("update", pos);

        // Arrival: was airborne, now firmly back on the ground.
        if (this._wasAirborne && onGround && spd < 40) {
          this._stop();
          this._emit("arrived", pos);
          return;
        }
        if (!onGround && alt > 500) this._wasAirborne = true;
      } catch (err) {
        console.warn("[Tracker] live poll failed:", err);
        this._maybeStale();
      }
    };

    poll();
    this._interval = setInterval(poll, this.cfg.livePollIntervalMs);
  }

  /** Map live telemetry onto the shared stepper phases. */
  _derivePhase(onGround, altFt, rateFpm, spdKt) {
    if (onGround) return spdKt >= 5 ? "taxi" : "scheduled";
    if (altFt < 8000 && rateFpm > 100) return "takeoff";
    return "airborne";
  }

  _maybeStale() {
    if (Date.now() - this.lastUpdateAt > this.cfg.staleAfterMs) {
      this._emit("stale", { since: this.lastUpdateAt });
    }
  }

  _stop() {
    clearInterval(this._interval);
    this._interval = null;
  }

  destroy() {
    this._destroyed = true;
    this._stop();
    this._handlers = { update: [], arrived: [], stale: [] };
  }
}
