/**
 * audio.js — AudioController
 *
 * Optional ambience that follows the flight phase:
 *   • before takeoff  → airport / terminal ambience
 *   • after takeoff    → cabin / in-flight ambience
 *
 * Designed around browser autoplay restrictions: nothing plays until
 * the user interacts (toggles unmute). If the audio files are missing,
 * the controller degrades gracefully and reports "unavailable" rather
 * than throwing. Volume + mute are user-controlled.
 */

export class AudioController {
  constructor(cfg) {
    this.cfg = cfg;
    this.airportEl = document.getElementById("audio-airport");
    this.cabinEl = document.getElementById("audio-cabin");
    this.muted = cfg.audio.startMuted;
    this.volume = cfg.audio.defaultVolume;
    this.mode = "off"; // "off" | "airport" | "cabin"
    this.available = { airport: true, cabin: true };
    this._userInteracted = false;

    this.airportEl.src = cfg.audio.airportSrc;
    this.cabinEl.src = cfg.audio.cabinSrc;
    [this.airportEl, this.cabinEl].forEach((el) => {
      el.volume = this.volume;
      el.addEventListener("error", () => this._markUnavailable(el));
    });

    this._onChange = null;
  }

  onChange(fn) {
    this._onChange = fn;
  }

  _markUnavailable(el) {
    if (el === this.airportEl) this.available.airport = false;
    if (el === this.cabinEl) this.available.cabin = false;
    this._notify();
  }

  _notify() {
    if (this._onChange) {
      this._onChange({
        muted: this.muted,
        mode: this.mode,
        volume: this.volume,
        available: this.available
      });
    }
  }

  /** Switch ambience to match a flight phase. */
  setPhase(phase) {
    const airborne = phase === "airborne" || phase === "arrived";
    this.mode = airborne ? "cabin" : "airport";
    this._apply();
  }

  setMode(mode) {
    this.mode = mode;
    this._apply();
  }

  toggleMute() {
    this.muted = !this.muted;
    this._userInteracted = true;
    this._apply();
    return this.muted;
  }

  setVolume(v01) {
    this.volume = Math.max(0, Math.min(1, v01));
    this.airportEl.volume = this.volume;
    this.cabinEl.volume = this.volume;
    this._notify();
  }

  /** Reconcile element playback with current mode/mute state. */
  _apply() {
    const wantAirport = !this.muted && this.mode === "airport" && this.available.airport;
    const wantCabin = !this.muted && this.mode === "cabin" && this.available.cabin;

    this._setPlaying(this.airportEl, wantAirport);
    this._setPlaying(this.cabinEl, wantCabin);
    this._notify();
  }

  _setPlaying(el, shouldPlay) {
    if (shouldPlay) {
      const p = el.play();
      if (p && p.catch) {
        p.catch(() => {
          // Autoplay blocked or file missing — surface as unavailable
          // only if it's a load error; autoplay block resolves on the
          // next user gesture (the unmute click counts).
        });
      }
    } else {
      el.pause();
    }
  }

  /** Human label for the current ambience state. */
  label() {
    if (this.muted) return "Audio: off";
    if (this.mode === "airport") {
      return this.available.airport ? "Audio: terminal" : "Audio: (no file)";
    }
    if (this.mode === "cabin") {
      return this.available.cabin ? "Audio: cabin" : "Audio: (no file)";
    }
    return "Audio: off";
  }

  stop() {
    this.airportEl.pause();
    this.cabinEl.pause();
    this.mode = "off";
    this._notify();
  }
}
