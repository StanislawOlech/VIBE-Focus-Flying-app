/**
 * app.js — Application entry point / orchestrator.
 *
 * Wires the independent modules together and owns the high-level
 * user flow:
 *
 *   load map + data
 *     → select airport
 *       → list departures
 *         → select flight
 *           → run phase state machine (scheduled…takeoff)
 *             → on AIRBORNE: draw route, start live tracking, swap audio
 *               → on ARRIVED: stop + summarise
 *
 * Each concern lives in its own module; this file only coordinates
 * them and manages teardown so switching flights never leaks timers.
 */

import { AirportService } from "./js/airports.js";
import { FlightService, fetchRoute, estimateArrival } from "./js/flights.js";
import { MapController } from "./js/map.js";
import { FlightStateMachine, PHASE_LABELS } from "./js/flightState.js";
import { Tracker } from "./js/tracking.js";
import { AudioController } from "./js/audio.js";
import { UIController } from "./js/ui.js";
import { debounce, fmtNum, fmtTime } from "./js/util.js";

class App {
  constructor() {
    this.cfg = window.APP_CONFIG;
    this.ui = new UIController();
    this.map = new MapController(this.cfg);
    this.airports = new AirportService();
    this.flights = new FlightService(this.cfg, this.airports);
    this.audio = new AudioController(this.cfg);

    // Active selection / live session.
    this.selectedAirport = null;
    this.session = null; // { flight, machine, tracker }
  }

  async init() {
    this.ui.setMode(this.cfg.mode);
    this.ui.startClock();

    // Wire audio UI first so it works regardless of data loading.
    this._wireAudio();
    this._wireFollow();
    this._wireCancel();

    // Map can initialise immediately (independent of data files).
    try {
      this.map.init("map");
      this.map.onAirportSelect((a) => this.selectAirport(a));
    } catch (err) {
      this.ui.setStatus("Map failed to load (is Leaflet reachable?)", "error");
      this.ui.toast("Map library could not be initialised.", "error");
      console.error(err);
    }

    // Load datasets.
    try {
      this.ui.setStatus("Loading airport & flight data…", "busy");
      await Promise.all([this.airports.load(), this.flights.load()]);
      this.map.renderAirports(this.airports.airports);
      this.ui.hideMapLoading();
      this.ui.setStatus("Ready — pick an airport to begin.", "ok");
    } catch (err) {
      console.error(err);
      this.ui.hideMapLoading();
      this.ui.setStatus("Failed to load data files.", "error");
      this.ui.toast("Could not load data. Are you serving over http?", "error");
      return;
    }

    if (this.cfg.mode === "live") {
      this.ui.toast(
        "Live mode on. Departure boards are synthesized; aircraft positions use live data when a transponder id is available.",
        "warn",
        6000
      );
    }

    this._wireSearch();
    this._wireRefresh();
  }

  /* ============================ AIRPORT SELECTION ============================ */
  async selectAirport(airport) {
    this.selectedAirport = airport;
    this.ui.renderAirportDetails(airport);
    this.map.highlightAirport(airport);

    // Selecting a new airport ends any running flight session.
    this._teardownSession();
    this.ui.clearFlightPanel();
    this.ui.hideHUD();

    this.ui.setStatus(`Loading departures from ${airport.iata}…`, "busy");
    this.ui.showDeparturesLoading();

    try {
      const departures = await this.flights.getDepartures(airport);

      if (departures.liveFailed) {
        this.ui.toast("Live data unavailable — showing demo departures instead.", "warn", 5000);
      }

      if (!departures.length) {
        const msg =
          this.cfg.mode === "live"
            ? `No live traffic within ${this.cfg.live.searchRadiusNm} nm of ${airport.iata} right now. Try a busy hub (JFK, LHR, AMS) or refresh.`
            : `No departures found for ${airport.iata}.`;
        this.ui.showDeparturesEmpty(msg);
        this.ui.setStatus("No flights available.", "");
        return;
      }
      this.currentDepartures = departures;
      this.ui.renderDepartures(departures, (f) => this.selectFlight(f));
      const live = departures.live && !departures.liveFailed;
      if (live) this._enrichLiveDestinations(departures);
      this.ui.setStatus(
        live
          ? `${departures.length} live aircraft near ${airport.name}. Pick one to track in real time.`
          : `${departures.length} departures from ${airport.name}. Pick one to track.`,
        "ok"
      );
    } catch (err) {
      console.error(err);
      this.ui.showDeparturesError("Departure data unavailable.");
      this.ui.setStatus("Departure data unavailable.", "error");
    }
  }

  /**
   * Live ADS-B lists carry no destination, so look each one up by
   * callsign and fill in the destination city + arrival estimate as the
   * results arrive. A per-selection token prevents stale lookups from a
   * previously selected airport writing into the current list.
   */
  _enrichLiveDestinations(departures) {
    const token = (this._enrichToken = Symbol("enrich"));
    for (const f of departures) {
      if (!f.live || !f.callsign) continue;
      fetchRoute(f.callsign).then((route) => {
        if (this._enrichToken !== token) return;
        if (!route || !route.destination) {
          this.ui.updateLiveCardRoute(f.id, "Destination unknown", "");
          return;
        }
        f.routeDestination = route.destination;
        const est = estimateArrival(route.destination, f.snapshot);
        const etaText = est ? `arrives ~${fmtTime(est.eta)}` : "";
        this.ui.updateLiveCardRoute(f.id, route.destination.city, etaText);
      });
    }
  }

  /* ============================ FLIGHT SELECTION ============================ */
  selectFlight(flight) {
    if (flight.live) return this._selectLiveFlight(flight);

    this._teardownSession();
    this.ui.selectFlightCard(flight.id);
    this.ui.renderFlightDetail(flight);

    const machine = new FlightStateMachine(flight, this.cfg);
    this.session = { flight, machine, tracker: null };

    machine.on("phase", (phase) => this._onPhase(phase, flight));
    machine.on("countdown", (sec, phase) => this.ui.updateCountdown(sec, phase));
    machine.on("airborne", () => this._onAirborne(flight));

    machine.start();

    // Audio ambience for the pre-flight (terminal) phase.
    this.audio.setPhase("scheduled");

    this.ui.toast(
      `Tracking ${flight.flightNumber} to ${flight.destination.city}. Waiting for takeoff…`,
      "ok"
    );
  }

  /* ----------------------- LIVE (real-time) tracking ----------------------- */
  _selectLiveFlight(flight) {
    this._teardownSession();
    this.ui.selectFlightCard(flight.id);
    this.ui.renderFlightDetail(flight); // live layout: readouts visible now
    this.ui.showHUD(flight);
    this.ui.setFollowActive(this.map.follow);

    // Seed the map + panels with the snapshot captured when listing,
    // so the aircraft appears instantly before the first poll returns.
    const snap = flight.snapshot;
    if (snap) {
      const seed = { ...snap, status: flight.liveStatus, progress: null };
      this.map.updateAircraft(seed);
      this.map.focusAircraft(snap.lat, snap.lon, snap.onGround ? 11 : 7);
      this.ui.updateReadout(seed);
      this.ui.updateHUD(seed);
    }

    const tracker = new Tracker(flight, this.cfg);
    this.session = { flight, machine: null, tracker };

    // Resolve the real destination (ADS-B carries none) and show the
    // arrival estimate. Reuses the per-session enrich token so a stale
    // lookup from another selection never overwrites this panel.
    if (flight.callsign) {
      fetchRoute(flight.callsign).then((route) => {
        if (!this.session || this.session.flight !== flight) return;
        if (!route || !route.destination) {
          this.ui.setDestination("Unknown", "destination not in database");
          return;
        }
        flight.routeDestination = route.destination;
        this._updateLiveArrival(flight, flight.snapshot);
        this.ui.showHUD(flight); // refresh HUD destination city
      });
    } else {
      this.ui.setDestination("Unknown", "no callsign to resolve route");
    }

    let firstFix = !!snap;
    tracker.on("phase", (phase) => {
      this.ui.updateStepper(phase);
      this.ui.setPhasePill(phase);
      this.audio.setPhase(phase);
    });
    tracker.on("update", (pos) => {
      this.map.updateAircraft(pos);
      this.ui.updateReadout(pos);
      this.ui.updateHUD(pos);
      this.ui.setLiveStatus(
        `${pos.status} · ${pos.onGround ? "on ground" : fmtNum(pos.altitudeFt) + " ft"}`
      );
      if (flight.routeDestination) this._updateLiveArrival(flight, pos);
      if (!firstFix) {
        firstFix = true;
        this.map.focusAircraft(pos.lat, pos.lon, pos.onGround ? 11 : 7);
      }
    });
    tracker.on("stale", () => {
      this.ui.setStatus("Live data is stale (signal lost) — last known position shown.", "error");
      this.ui.setLiveStatus("Signal lost — last known position");
      this.ui.toast("ADS-B signal lost; showing last known location.", "warn");
    });
    tracker.on("arrived", (pos) => {
      this.ui.updateStepper("arrived");
      this.ui.setPhasePill("arrived");
      this.ui.updateReadout(pos);
      this.ui.updateHUD(pos);
      this.ui.setLiveStatus("On ground (arrived)");
      this.ui.setStatus(`${flight.flightNumber} has landed.`, "ok");
      this.ui.toast(`✈ ${flight.flightNumber} is on the ground.`, "ok", 6000);
    });

    tracker.start();

    this.audio.setPhase(snap && snap.onGround ? "scheduled" : "airborne");
    this.ui.setStatus(`Tracking ${flight.flightNumber} live — ${flight.liveStatus}.`, "ok");
    this.ui.toast(
      snap && snap.onGround
        ? `Live-tracking ${flight.flightNumber}. It's on the ground — waiting for takeoff…`
        : `Live-tracking ${flight.flightNumber}. Position updates every ${this.cfg.livePollIntervalMs / 1000}s.`,
      "ok",
      5000
    );
  }

  /** Recompute and render the destination city + arrival estimate. */
  _updateLiveArrival(flight, pos) {
    const dest = flight.routeDestination;
    if (!dest || !pos) return;
    const est = estimateArrival(dest, pos);
    const etaText = est ? `arrives ~${fmtTime(est.eta)}` : "en route";
    this.ui.setDestination(dest.city, etaText);
  }

  _onPhase(phase, flight) {
    this.ui.updateStepper(phase);
    this.ui.setPhasePill(phase);
    this.audio.setPhase(phase);

    const msgs = {
      scheduled: `${flight.flightNumber} is at gate ${flight.gate} (Terminal ${flight.terminal}).`,
      boarding: `${flight.flightNumber} is now boarding.`,
      taxi: `${flight.flightNumber} is taxiing to the runway.`,
      takeoff: `${flight.flightNumber} is taking off!`,
      airborne: `${flight.flightNumber} is airborne — tracking live.`,
      arrived: `${flight.flightNumber} has arrived at ${flight.destination.city}.`
    };
    this.ui.setStatus(msgs[phase] || PHASE_LABELS[phase], phase === "takeoff" ? "busy" : "ok");
  }

  /* ============================ TRACKING ============================ */
  _onAirborne(flight) {
    // Draw the route and reveal the tracking HUD + live readouts.
    this.map.showRoute(flight.origin, flight.destination);
    this.ui.showHUD(flight);
    this.ui.setFollowActive(this.map.follow);
    this.ui.enterTrackingView();

    const tracker = new Tracker(flight, this.cfg);
    if (this.session) this.session.tracker = tracker;

    tracker.on("update", (pos) => {
      this.map.updateAircraft(pos);
      this.ui.updateReadout(pos);
      this.ui.updateHUD(pos);
    });
    tracker.on("stale", () => {
      this.ui.setStatus("Tracking data unavailable (stale) — last known position shown.", "error");
      this.ui.toast("Live position is stale; showing last known location.", "warn");
    });
    tracker.on("arrived", (pos) => {
      this.ui.updateStepper("arrived");
      this.ui.setPhasePill("arrived");
      this.ui.updateReadout(pos);
      this.ui.updateHUD(pos);
      this.ui.setStatus(
        `${flight.flightNumber} arrived at ${flight.destination.city} (${flight.destination.iata}).`,
        "ok"
      );
      this.ui.toast(`✈ ${flight.flightNumber} has landed at ${flight.destination.iata}.`, "ok", 6000);
    });

    tracker.start();
  }

  /* ============================ TEARDOWN ============================ */
  _teardownSession() {
    if (this.session) {
      this.session.machine?.destroy();
      this.session.tracker?.destroy();
      this.session = null;
    }
    this.map.clearTracking();
  }

  _wireCancel() {
    this.ui.bindCancelFlight(() => {
      this._teardownSession();
      this.ui.clearFlightPanel();
      this.ui.hideHUD();
      this.audio.setMode("airport"); // back to terminal ambience
      this.ui.setStatus("Flight cleared. Pick another departure.", "");
    });
  }

  _wireFollow() {
    this.ui.bindFollowToggle(() => {
      const next = !this.map.follow;
      this.map.setFollow(next);
      this.ui.setFollowActive(next);
    });
  }

  /* ============================ SEARCH ============================ */
  _wireSearch() {
    const onInput = debounce((q) => {
      if (!q || !q.trim()) return this.ui.hideSearchResults();
      const results = this.airports.search(q);
      this.ui.renderSearchResults(results, (a) => {
        this.selectAirport(a);
        this.map.openAirportPopup(a);
      });
    }, 120);
    this.ui.bindSearch(onInput);
  }

  _wireRefresh() {
    this.ui.bindRefresh(() => {
      if (this.selectedAirport) this.selectAirport(this.selectedAirport);
    });
  }

  /* ============================ AUDIO ============================ */
  _wireAudio() {
    this.audio.onChange((state) => this.ui.renderAudioState(state, this.audio.label()));
    this.ui.bindAudio(
      () => {
        const muted = this.audio.toggleMute();
        if (!muted && this.audio.mode === "off") this.audio.setMode("airport");
        this.ui.renderAudioState(
          { muted, mode: this.audio.mode, volume: this.audio.volume, available: this.audio.available },
          this.audio.label()
        );
        if (!muted) {
          this.ui.toast("Ambient audio on. Add files to assets/audio/ for sound.", "", 4000);
        }
      },
      (v) => this.audio.setVolume(v)
    );
    // Initial render.
    this.ui.renderAudioState(
      { muted: this.audio.muted, mode: this.audio.mode, volume: this.audio.volume, available: this.audio.available },
      this.audio.label()
    );
  }
}

// Boot once the DOM is ready.
window.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  window.__focusFlying = app; // handy for debugging in the console
  app.init();
});
