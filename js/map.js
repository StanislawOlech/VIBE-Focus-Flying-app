/**
 * map.js — MapController
 *
 * Thin wrapper around Leaflet that owns all map rendering concerns:
 * the base layer, airport pins, the highlighted route, and the live
 * aircraft marker. Everything else talks to the map through this
 * class so the rest of the app never touches Leaflet directly.
 */

import { greatCirclePoints } from "./geo.js";

export class MapController {
  constructor(cfg) {
    this.cfg = cfg;
    this.map = null;
    this.airportMarkers = new Map(); // iata -> marker
    this.selectedIata = null;
    this.routeLine = null;
    this.routeGlow = null;
    this.planeMarker = null;
    this.trailLine = null;
    this.trail = [];
    this.follow = true;
    this._onAirportSelect = null;
  }

  init(containerId = "map") {
    const m = this.cfg.map;
    this.map = L.map(containerId, {
      center: m.initialCenter,
      zoom: m.initialZoom,
      minZoom: m.minZoom,
      maxZoom: m.maxZoom,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer(m.tileUrl, {
      attribution: m.tileAttribution,
      maxZoom: m.maxZoom,
      subdomains: "abcd"
    }).addTo(this.map);

    return this;
  }

  onAirportSelect(fn) {
    this._onAirportSelect = fn;
  }

  /* ============================ AIRPORTS ============================ */
  renderAirports(airports) {
    airports.forEach((a) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="airport-marker" data-iata="${a.iata}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      const marker = L.marker([a.lat, a.lon], { icon, title: `${a.name} (${a.iata})` });
      marker.addTo(this.map);
      marker.bindPopup(this._airportPopup(a));
      marker.on("popupopen", () => this._wirePopupButton(a));
      this.airportMarkers.set(a.iata, marker);
    });
  }

  _airportPopup(a) {
    return `
      <div class="popup">
        <div class="popup-title">${a.name}</div>
        <div class="popup-sub">${a.city}, ${a.country} · ${a.iata} / ${a.icao}</div>
        <button class="popup-btn" data-select="${a.iata}">Select this airport</button>
      </div>`;
  }

  _wirePopupButton(a) {
    const btn = document.querySelector(`.popup-btn[data-select="${a.iata}"]`);
    if (btn) {
      btn.addEventListener("click", () => {
        this.map.closePopup();
        if (this._onAirportSelect) this._onAirportSelect(a);
      });
    }
  }

  highlightAirport(airport, { fly = true } = {}) {
    // Reset previous selection styling.
    if (this.selectedIata) {
      const prev = this.airportMarkers.get(this.selectedIata);
      const el = prev && prev.getElement()?.querySelector(".airport-marker");
      if (el) el.classList.remove("selected");
    }
    this.selectedIata = airport.iata;
    const marker = this.airportMarkers.get(airport.iata);
    if (marker) {
      const el = marker.getElement()?.querySelector(".airport-marker");
      if (el) el.classList.add("selected");
    }
    if (fly) this.map.flyTo([airport.lat, airport.lon], 5, { duration: 1.1 });
  }

  openAirportPopup(airport) {
    const marker = this.airportMarkers.get(airport.iata);
    if (marker) marker.openPopup();
  }

  /* ============================ ROUTE ============================ */
  showRoute(origin, dest) {
    this.clearRoute();
    const pts = greatCirclePoints(origin, dest, 96);
    this.routeGlow = L.polyline(pts, {
      color: "#4da3ff",
      weight: 7,
      opacity: 0.12,
      lineCap: "round"
    }).addTo(this.map);
    this.routeLine = L.polyline(pts, {
      color: "#4da3ff",
      weight: 2,
      opacity: 0.85,
      dashArray: "1 8",
      lineCap: "round"
    }).addTo(this.map);

    const bounds = L.latLngBounds(pts);
    this.map.flyToBounds(bounds, { padding: [80, 80], duration: 1.1, maxZoom: 6 });
  }

  clearRoute() {
    if (this.routeLine) this.map.removeLayer(this.routeLine);
    if (this.routeGlow) this.map.removeLayer(this.routeGlow);
    this.routeLine = this.routeGlow = null;
  }

  /* ============================ AIRCRAFT ============================ */
  updateAircraft(pos) {
    const latlng = [pos.lat, pos.lon];

    if (!this.planeMarker) {
      const icon = this._planeIcon(pos.heading);
      this.planeMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(this.map);
      this.trail = [];
      this.trailLine = L.polyline([], {
        color: "#38e0c4",
        weight: 3,
        opacity: 0.9,
        lineCap: "round"
      }).addTo(this.map);
    } else {
      this.planeMarker.setLatLng(latlng);
      const el = this.planeMarker.getElement()?.querySelector(".plane-icon");
      if (el) el.style.transform = `rotate(${pos.heading - 45}deg)`;
    }

    // Update the breadcrumb trail of where the aircraft has been.
    this.trail.push(latlng);
    if (this.trailLine) this.trailLine.setLatLngs(this.trail);

    if (this.follow) {
      this.map.panTo(latlng, { animate: true, duration: 0.6 });
    }
  }

  _planeIcon(heading) {
    return L.divIcon({
      className: "",
      // ✈ glyph points NE (~45°); offset so rotate(0) faces north.
      html: `<div class="plane-icon" style="transform: rotate(${heading - 45}deg)">✈</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  /** Smoothly center + zoom onto an aircraft (used on first live fix). */
  focusAircraft(lat, lon, zoom = 8) {
    this.map.flyTo([lat, lon], zoom, { duration: 1.2 });
  }

  setFollow(on) {
    this.follow = on;
    if (on && this.planeMarker) {
      this.map.panTo(this.planeMarker.getLatLng(), { animate: true });
    }
  }

  clearTracking() {
    if (this.planeMarker) this.map.removeLayer(this.planeMarker);
    if (this.trailLine) this.map.removeLayer(this.trailLine);
    this.planeMarker = this.trailLine = null;
    this.trail = [];
    this.clearRoute();
  }

  invalidate() {
    if (this.map) this.map.invalidateSize();
  }
}
