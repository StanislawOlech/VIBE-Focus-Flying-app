/**
 * ui.js — UIController
 *
 * Owns every DOM read/write outside the map. Pure presentation: it
 * renders airports, departures, the selected-flight panel, the phase
 * stepper, the floating tracking HUD, and status/toast messaging.
 * It exposes small bind* methods so app.js can attach behaviour
 * without the UI knowing about flight logic.
 */

import { PHASE_LABELS } from "./flightState.js";
import { fmtTime, fmtCountdown, fmtNum, compass } from "./util.js";

const PHASE_CLASS = {
  scheduled: "ph-scheduled",
  boarding: "ph-boarding",
  taxi: "ph-taxi",
  takeoff: "ph-takeoff",
  airborne: "ph-airborne",
  arrived: "ph-arrived"
};

const STEPPER_PHASES = ["scheduled", "boarding", "taxi", "takeoff", "airborne"];

const LIVE_STATUS_CLASS = {
  "On ground": "ph-scheduled",
  Taxiing: "ph-taxi",
  Departing: "ph-takeoff",
  Airborne: "ph-airborne",
  Arriving: "ph-arrived"
};

export class UIController {
  constructor() {
    this.el = {
      modeBadge: document.getElementById("mode-badge"),
      search: document.getElementById("airport-search"),
      searchResults: document.getElementById("search-results"),
      airportDetails: document.getElementById("airport-details"),
      departuresList: document.getElementById("departures-list"),
      refreshBtn: document.getElementById("refresh-departures"),
      flightPanel: document.getElementById("flight-panel"),
      flightDetail: document.getElementById("flight-detail"),
      cancelFlight: document.getElementById("cancel-flight"),
      // HUD
      hud: document.getElementById("track-hud"),
      hudFlight: document.getElementById("hud-flight"),
      hudOrigin: document.getElementById("hud-origin"),
      hudDest: document.getElementById("hud-dest"),
      hudAlt: document.getElementById("hud-alt"),
      hudSpeed: document.getElementById("hud-speed"),
      hudHdg: document.getElementById("hud-hdg"),
      hudProgress: document.getElementById("hud-progress"),
      hudUpdated: document.getElementById("hud-updated"),
      followToggle: document.getElementById("follow-toggle"),
      // status
      statusDot: document.getElementById("status-dot"),
      statusText: document.getElementById("status-text"),
      phasePill: document.getElementById("phase-pill"),
      clock: document.getElementById("clock"),
      toast: document.getElementById("toast"),
      mapLoading: document.getElementById("map-loading"),
      // audio
      audioIcon: document.getElementById("audio-icon"),
      audioToggle: document.getElementById("audio-toggle"),
      audioLabel: document.getElementById("audio-label"),
      volume: document.getElementById("volume-slider")
    };
    this._toastTimer = null;
  }

  /* ============================ MODE ============================ */
  setMode(mode) {
    const b = this.el.modeBadge;
    if (mode === "live") {
      b.textContent = "LIVE MODE";
      b.className = "badge badge-live";
    } else {
      b.textContent = "DEMO MODE";
      b.className = "badge badge-demo";
    }
  }

  hideMapLoading() {
    this.el.mapLoading.classList.add("hidden");
  }

  /* ============================ SEARCH ============================ */
  bindSearch(onInput, onClear) {
    this.el.search.addEventListener("input", (e) => onInput(e.target.value));
    this.el.search.addEventListener("focus", (e) => {
      if (e.target.value) onInput(e.target.value);
    });
    document.addEventListener("click", (e) => {
      if (!this.el.searchResults.contains(e.target) && e.target !== this.el.search) {
        this.hideSearchResults();
      }
    });
  }

  renderSearchResults(airports, onPick) {
    const list = this.el.searchResults;
    if (!airports.length) {
      list.innerHTML = `<li class="hint" style="cursor:default">No matching airports</li>`;
      list.hidden = false;
      return;
    }
    list.innerHTML = airports
      .map(
        (a) => `
        <li data-iata="${a.iata}">
          <span class="code-chip">${a.iata}</span>
          <span class="result-meta">
            <span class="result-name">${a.name}</span>
            <span class="result-sub">${a.city}, ${a.country} · ${a.icao}</span>
          </span>
        </li>`
      )
      .join("");
    list.hidden = false;
    list.querySelectorAll("li[data-iata]").forEach((li) => {
      li.addEventListener("click", () => {
        const a = airports.find((x) => x.iata === li.dataset.iata);
        this.hideSearchResults();
        this.el.search.value = "";
        onPick(a);
      });
    });
  }

  hideSearchResults() {
    this.el.searchResults.hidden = true;
  }

  /* ============================ AIRPORT DETAILS ============================ */
  renderAirportDetails(a) {
    this.el.airportDetails.className = "airport-details";
    this.el.airportDetails.innerHTML = `
      <div class="airport-name">${a.name}</div>
      <div class="airport-loc">${a.city}, ${a.country}</div>
      <div class="code-row">
        <span class="code-chip">IATA ${a.iata}</span>
        <span class="code-chip">ICAO ${a.icao}</span>
        <span class="code-chip">${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}</span>
      </div>`;
  }

  /* ============================ DEPARTURES ============================ */
  showDeparturesLoading() {
    this.el.departuresList.innerHTML = `
      <div class="hint" style="display:flex;align-items:center;gap:10px;">
        <span class="spinner" style="width:18px;height:18px;border-width:2px;"></span>
        Loading departures…
      </div>`;
    this.el.refreshBtn.hidden = true;
  }

  showDeparturesEmpty(msg = "No departures found for this airport.") {
    this.el.departuresList.innerHTML = `<p class="hint empty-state">${msg}</p>`;
    this.el.refreshBtn.hidden = false;
  }

  showDeparturesError(msg = "Could not load departures.") {
    this.el.departuresList.innerHTML = `<p class="hint" style="color:var(--danger)">${msg}</p>`;
    this.el.refreshBtn.hidden = false;
  }

  renderDepartures(flights, onSelect) {
    if (!flights.length) return this.showDeparturesEmpty();
    this.el.refreshBtn.hidden = false;
    this.el.departuresList.innerHTML = flights
      .map((f) => (f.live ? this._liveCard(f) : this._demoCard(f)))
      .join("");
    this.el.departuresList.querySelectorAll(".flight-card").forEach((card) => {
      card.addEventListener("click", () => {
        const f = flights.find((x) => x.id === card.dataset.id);
        onSelect(f);
      });
    });
  }

  _demoCard(f) {
    return `
      <div class="flight-card" data-id="${f.id}">
        <div class="fc-top">
          <span class="fc-flight">${f.flightNumber}</span>
          <span class="fc-time">${fmtTime(f.scheduledDep)}</span>
        </div>
        <div class="fc-route">→ ${f.destination.city} (${f.destination.iata})</div>
        <div class="fc-sub">
          <span>${f.airline.name}</span>
          <span>${f.aircraft.type}</span>
        </div>
        <div class="fc-sub">
          <span>Terminal ${f.terminal} · Gate ${f.gate}</span>
          <span>${fmtNum(f.distanceKm)} km</span>
        </div>
      </div>`;
  }

  _liveCard(f) {
    const cls = LIVE_STATUS_CLASS[f.liveStatus] || "ph-scheduled";
    const dist = f._distNm != null && f._distNm < 9999 ? `${f._distNm.toFixed(0)} nm away` : "";
    const altLine = f.snapshot.onGround
      ? "on ground"
      : `${fmtNum(f.snapshot.altitudeFt)} ft · ${fmtNum(f.snapshot.speedKt)} kt`;
    const destInit = f.callsign ? "Looking up destination…" : "Destination unknown";
    return `
      <div class="flight-card" data-id="${f.id}">
        <div class="fc-top">
          <span class="fc-flight">${f.flightNumber || f.registration || f.icao24}</span>
          <span class="fc-status ${cls}">${f.liveStatus}</span>
        </div>
        <div class="fc-route" data-dest="${f.id}">→ ${destInit}</div>
        <div class="fc-sub">
          <span>${f.aircraft.type}</span>
          <span data-eta="${f.id}"></span>
        </div>
        <div class="fc-sub">
          <span>${altLine}</span>
          <span>${dist}</span>
        </div>
      </div>`;
  }

  /** Fill in a live card's resolved destination city + arrival estimate. */
  updateLiveCardRoute(id, destCity, etaText) {
    const list = this.el.departuresList;
    const dest = list.querySelector(`[data-dest="${CSS.escape(id)}"]`);
    if (dest) dest.textContent = `→ ${destCity}`;
    const eta = list.querySelector(`[data-eta="${CSS.escape(id)}"]`);
    if (eta) eta.textContent = etaText || "";
  }

  selectFlightCard(id) {
    this.el.departuresList.querySelectorAll(".flight-card").forEach((c) => {
      c.classList.toggle("selected", c.dataset.id === id);
    });
  }

  /* ============================ FLIGHT DETAIL ============================ */
  renderFlightDetail(flight) {
    this.el.flightPanel.hidden = false;
    const stepper = `
      <div class="stepper" id="stepper">
        ${STEPPER_PHASES.map(
          (p) => `
          <div class="step" data-phase="${p}">
            <span class="dot"></span>
            <span class="lbl">${PHASE_LABELS[p]}</span>
          </div>`
        ).join("")}
      </div>`;

    if (flight.live) {
      this.el.flightDetail.innerHTML = `
        <div class="detail-head">
          <div>
            <div class="detail-flight">${flight.flightNumber || flight.registration || flight.icao24}</div>
            <div class="detail-airline">${flight.aircraft.type}</div>
          </div>
          <span class="fc-status ph-airborne" id="detail-status">${flight.liveStatus}</span>
        </div>

        <div class="detail-route">
          <div class="endpoint">
            <div class="code">${flight.origin.city}</div>
            <div class="city">${flight.origin.name}</div>
          </div>
          <div class="route-line">● live</div>
          <div class="endpoint">
            <div class="code" id="detail-dest-city">${flight.callsign ? "…" : "—"}</div>
            <div class="city" id="detail-dest-eta">${flight.callsign ? "looking up route" : "destination unknown"}</div>
          </div>
        </div>

        ${stepper}

        <div class="countdown-box" id="countdown-box">
          <div class="cd-label" id="cd-label">Live status</div>
          <div class="cd-value" id="cd-value" style="font-size:16px">Connecting…</div>
        </div>

        <div class="readout" id="readout">
          <div class="cell"><label>Altitude</label><span class="val" id="ro-alt">—</span></div>
          <div class="cell"><label>Ground speed</label><span class="val" id="ro-speed">—</span></div>
          <div class="cell"><label>Heading</label><span class="val" id="ro-hdg">—</span></div>
          <div class="cell"><label>Vertical speed</label><span class="val" id="ro-vs">—</span></div>
        </div>
      `;
      return;
    }

    this.el.flightDetail.innerHTML = `
      <div class="detail-head">
        <div>
          <div class="detail-flight">${flight.flightNumber}</div>
          <div class="detail-airline">${flight.airline.name} · ${flight.aircraft.type}</div>
        </div>
        <span class="fc-status ph-scheduled" id="detail-status">Scheduled</span>
      </div>

      <div class="detail-route">
        <div class="endpoint">
          <div class="code">${flight.origin.city}</div>
          <div class="city">${flight.origin.name}</div>
        </div>
        <div class="route-line">✈ ${fmtNum(flight.distanceKm)} km</div>
        <div class="endpoint">
          <div class="code">${flight.destination.city}</div>
          <div class="city">${flight.destination.name}</div>
        </div>
      </div>

      ${stepper}

      <div class="countdown-box" id="countdown-box">
        <div class="cd-label" id="cd-label">Estimated time to takeoff</div>
        <div class="cd-value" id="cd-value">--:--</div>
      </div>

      <div class="readout" id="readout" hidden>
        <div class="cell"><label>Altitude</label><span class="val" id="ro-alt">—</span></div>
        <div class="cell"><label>Ground speed</label><span class="val" id="ro-speed">—</span></div>
        <div class="cell"><label>Heading</label><span class="val" id="ro-hdg">—</span></div>
        <div class="cell"><label>Distance to go</label><span class="val" id="ro-dist">—</span></div>
      </div>
    `;
  }

  /** Update the live-status line in the (repurposed) countdown box. */
  setLiveStatus(text) {
    const v = document.getElementById("cd-value");
    if (v) v.textContent = text;
  }

  /** Fill the destination endpoint with a resolved city + arrival estimate. */
  setDestination(destCity, etaText) {
    const c = document.getElementById("detail-dest-city");
    const e = document.getElementById("detail-dest-eta");
    if (c) c.textContent = destCity || "—";
    if (e) e.textContent = etaText || "";
  }

  updateStepper(phase) {
    const stepper = document.getElementById("stepper");
    if (!stepper) return;
    const idx = STEPPER_PHASES.indexOf(phase === "arrived" ? "airborne" : phase);
    stepper.querySelectorAll(".step").forEach((step, i) => {
      step.classList.toggle("done", i < idx);
      step.classList.toggle("active", i === idx);
    });
    const badge = document.getElementById("detail-status");
    if (badge) {
      badge.textContent = PHASE_LABELS[phase] || phase;
      badge.className = `fc-status ${PHASE_CLASS[phase] || ""}`;
    }
  }

  updateCountdown(seconds, phase) {
    const label = document.getElementById("cd-label");
    const value = document.getElementById("cd-value");
    if (!value) return;
    const map = {
      scheduled: "Estimated time to boarding/takeoff",
      boarding: "Boarding · time to takeoff",
      taxi: "Taxiing · time to takeoff",
      takeoff: "Cleared for takeoff"
    };
    if (label) label.textContent = map[phase] || "Time to takeoff";
    value.textContent = fmtCountdown(seconds);
  }

  /** Swap the countdown box for live readout once airborne. */
  enterTrackingView() {
    const cd = document.getElementById("countdown-box");
    const ro = document.getElementById("readout");
    if (cd) cd.hidden = true;
    if (ro) ro.hidden = false;
  }

  updateReadout(pos) {
    const set = (id, txt) => {
      const e = document.getElementById(id);
      if (e) e.textContent = txt;
    };
    set("ro-alt", pos.onGround ? "on ground" : `${fmtNum(pos.altitudeFt)} ft`);
    set("ro-speed", `${fmtNum(pos.speedKt)} kt`);
    set("ro-hdg", `${Math.round(pos.heading)}° ${compass(pos.heading)}`);
    if (pos.remainingKm != null) set("ro-dist", `${fmtNum(pos.remainingKm)} km`);
    if (pos.verticalRate != null) {
      const vr = Math.round(pos.verticalRate);
      set("ro-vs", `${vr > 0 ? "+" : ""}${fmtNum(vr)} fpm`);
    }
  }

  /* ============================ HUD ============================ */
  showHUD(flight) {
    this.el.hud.hidden = false;
    this.el.hudFlight.textContent = flight.flightNumber || flight.registration || flight.icao24;
    this.el.hudOrigin.textContent = flight.origin.city;
    this.el.hudDest.textContent = flight.live
      ? (flight.routeDestination ? flight.routeDestination.city : "…")
      : flight.destination.city;
    const progLabel = this.el.hudProgress.previousElementSibling;
    if (progLabel) progLabel.textContent = flight.live ? "Phase" : "Progress";
  }

  hideHUD() {
    this.el.hud.hidden = true;
  }

  updateHUD(pos) {
    this.el.hudAlt.textContent = pos.onGround ? "ground" : `${fmtNum(pos.altitudeFt)} ft`;
    this.el.hudSpeed.textContent = `${fmtNum(pos.speedKt)} kt`;
    this.el.hudHdg.textContent = `${Math.round(pos.heading)}° ${compass(pos.heading)}`;
    // Progress is unknown for live ADS-B (no destination) → show status.
    this.el.hudProgress.textContent =
      pos.progress != null ? `${Math.round(pos.progress * 100)}%` : pos.status || "—";
    this.el.hudUpdated.textContent = pos.stale
      ? "stale"
      : new Date(pos.timestamp).toLocaleTimeString([], { hour12: false });
  }

  setFollowActive(on) {
    this.el.followToggle.classList.toggle("chip-active", on);
    this.el.followToggle.textContent = on ? "⦿ Follow" : "○ Follow";
  }

  bindFollowToggle(fn) {
    this.el.followToggle.addEventListener("click", fn);
  }

  bindCancelFlight(fn) {
    this.el.cancelFlight.addEventListener("click", fn);
  }

  bindRefresh(fn) {
    this.el.refreshBtn.addEventListener("click", fn);
  }

  clearFlightPanel() {
    this.el.flightPanel.hidden = true;
    this.el.flightDetail.innerHTML = "";
    this.el.phasePill.hidden = true;
    this.selectFlightCard(null);
  }

  /* ============================ STATUS / TOAST ============================ */
  setStatus(text, kind = "") {
    this.el.statusText.textContent = text;
    this.el.statusDot.className = "status-dot" + (kind ? " " + kind : "");
  }

  setPhasePill(phase) {
    const pill = this.el.phasePill;
    pill.hidden = false;
    pill.textContent = (PHASE_LABELS[phase] || phase).toUpperCase();
    pill.className = `phase-pill ${PHASE_CLASS[phase] || ""}`;
  }

  toast(msg, kind = "", ms = 3800) {
    const t = this.el.toast;
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  startClock() {
    const tick = () => {
      this.el.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ============================ AUDIO ============================ */
  bindAudio(onToggle, onVolume) {
    this.el.audioToggle.addEventListener("click", onToggle);
    this.el.volume.addEventListener("input", (e) => onVolume(e.target.value / 100));
    this.el.volume.value = String(Math.round(50));
  }

  renderAudioState(state, label) {
    this.el.audioIcon.textContent = state.muted ? "🔇" : "🔊";
    this.el.audioToggle.setAttribute("aria-pressed", String(!state.muted));
    this.el.audioLabel.textContent = label;
  }
}
