/**
 * geo.js — Great-circle math helpers.
 *
 * All angles are in degrees on input/output unless noted. Distances
 * in kilometres. These power the simulated aircraft movement along a
 * realistic curved path between two airports.
 */

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Haversine great-circle distance in km. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing (heading) from a → b, degrees 0..360. */
export function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point at fraction f (0..1) along the great-circle from a → b.
 * Uses spherical interpolation (slerp) so the path curves like a
 * real flight route rather than a straight line on the projection.
 */
export function interpolate(a, b, f) {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const delta = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));

  if (delta === 0) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - f) * delta) / Math.sin(delta);
  const B = Math.sin(f * delta) / Math.sin(delta);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);
  return { lat: toDeg(lat), lon: toDeg(lon) };
}

/** Sample the great-circle into N points (for drawing the route line). */
export function greatCirclePoints(a, b, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = interpolate(a, b, i / n);
    pts.push([p.lat, p.lon]);
  }
  return pts;
}
