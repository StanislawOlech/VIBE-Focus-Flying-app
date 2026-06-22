/**
 * util.js — Small, dependency-free helpers shared across modules.
 */

/** Tiny seedable PRNG (mulberry32) for repeatable demo generation. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit int — used to seed per-airport RNG. */
export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export const randInt = (rng, min, max) =>
  Math.floor(rng() * (max - min + 1)) + min;

/** Apply +/- jitter fraction to a value. */
export const jitter = (rng, value, frac) =>
  value * (1 + (rng() * 2 - 1) * frac);

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Format a Date as HH:MM (24h). */
export function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtClock(d) {
  return d.toLocaleTimeString([], { hour12: false });
}

/** mm:ss countdown from seconds. */
export function fmtCountdown(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export const fmtNum = (n) => Math.round(n).toLocaleString();

/** Convert a compass heading to a coarse cardinal label. */
export function compass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

/** Debounce a function by `wait` ms. */
export function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** Knots → km/h and feet helpers. */
export const ktToKmh = (kt) => kt * 1.852;
