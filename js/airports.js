/**
 * airports.js — AirportService
 *
 * Loads the built-in airport dataset and provides lookup + fuzzy
 * search by name / city / IATA / ICAO. Kept independent of the map
 * and UI so it can be reused or swapped for a live airport API.
 */

export class AirportService {
  constructor() {
    this.airports = [];
    this._byIata = new Map();
    this._byIcao = new Map();
  }

  async load(url = "data/airports.json") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load airports (${res.status})`);
    this.airports = await res.json();
    for (const a of this.airports) {
      this._byIata.set(a.iata.toUpperCase(), a);
      this._byIcao.set(a.icao.toUpperCase(), a);
    }
    return this.airports;
  }

  get(code) {
    if (!code) return null;
    const c = code.toUpperCase();
    return this._byIata.get(c) || this._byIcao.get(c) || null;
  }

  /** Rank-based search across code/name/city/country. */
  search(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const a of this.airports) {
      const iata = a.iata.toLowerCase();
      const icao = a.icao.toLowerCase();
      const name = a.name.toLowerCase();
      const city = a.city.toLowerCase();
      const country = a.country.toLowerCase();

      let score = 0;
      if (iata === q || icao === q) score = 100;
      else if (iata.startsWith(q) || icao.startsWith(q)) score = 90;
      else if (city.startsWith(q) || name.startsWith(q)) score = 70;
      else if (name.includes(q) || city.includes(q)) score = 50;
      else if (country.includes(q)) score = 30;

      if (score > 0) scored.push({ a, score });
    }
    scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
    return scored.slice(0, limit).map((s) => s.a);
  }
}
