/**
 * flightState.js — FlightStateMachine
 *
 * Models the pre-flight phase progression for a selected flight:
 *
 *   scheduled → boarding → taxi → takeoff → airborne
 *
 * Phase durations come from config (time-compressed for the demo).
 * The machine is event-driven: consumers subscribe to phase changes
 * and a per-second countdown to the next phase. It does NOT know about
 * maps or audio — those react to the emitted events.
 *
 * The same machine is used in live mode; only the airborne position
 * source differs (see tracking.js).
 */

import { makeRng, hashCode, jitter } from "./util.js";

export const PHASES = ["scheduled", "boarding", "taxi", "takeoff", "airborne", "arrived"];

export const PHASE_LABELS = {
  scheduled: "Scheduled",
  boarding: "Boarding",
  taxi: "Taxiing",
  takeoff: "Takeoff",
  airborne: "Airborne",
  arrived: "Arrived"
};

export class FlightStateMachine {
  constructor(flight, cfg) {
    this.flight = flight;
    this.cfg = cfg;
    this.phase = "scheduled";
    this._timers = [];
    this._handlers = { phase: [], countdown: [], airborne: [] };
    this._destroyed = false;

    // Deterministic jitter per flight so the countdown is consistent.
    const rng = makeRng(hashCode(flight.id));
    const d = cfg.sim.phaseDurations;
    const j = cfg.sim.phaseJitter;
    this.durations = {
      scheduled: Math.round(jitter(rng, d.scheduled, j)),
      boarding: Math.round(jitter(rng, d.boarding, j)),
      taxi: Math.round(jitter(rng, d.taxi, j)),
      takeoff: Math.round(jitter(rng, d.takeoff, j))
    };
  }

  on(event, fn) {
    if (this._handlers[event]) this._handlers[event].push(fn);
    return this;
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach((fn) => fn(...args));
  }

  /** Begin the pre-departure sequence. */
  start() {
    this._emit("phase", this.phase, this.flight);
    this._scheduleChain();
    this._startCountdown();
    return this;
  }

  _scheduleChain() {
    const order = ["scheduled", "boarding", "taxi", "takeoff"];
    let elapsed = 0;
    order.forEach((ph, idx) => {
      const next = order[idx + 1] || "airborne";
      elapsed += this.durations[ph];
      const at = elapsed;
      this._timers.push(
        setTimeout(() => this._transition(next), at)
      );
    });
  }

  _transition(phase) {
    if (this._destroyed) return;
    this.phase = phase;
    this._phaseStartedAt = Date.now();
    this._emit("phase", phase, this.flight);
    if (phase === "airborne") {
      this._stopCountdown();
      this._emit("airborne", this.flight);
    }
  }

  /** Emits seconds remaining until the NEXT phase, once per second. */
  _startCountdown() {
    this._sequenceStart = Date.now();
    const tick = () => {
      if (this._destroyed || this.phase === "airborne") return;
      const elapsed = Date.now() - this._sequenceStart;
      const total =
        this.durations.scheduled +
        this.durations.boarding +
        this.durations.taxi +
        this.durations.takeoff;
      const remaining = Math.max(0, total - elapsed) / 1000;
      this._emit("countdown", remaining, this.phase);
    };
    tick();
    this._countdownTimer = setInterval(tick, 500);
  }

  _stopCountdown() {
    clearInterval(this._countdownTimer);
  }

  destroy() {
    this._destroyed = true;
    this._timers.forEach(clearTimeout);
    this._stopCountdown();
    this._handlers = { phase: [], countdown: [], airborne: [] };
  }
}
