/**
 * config.local.example.js  (template — safe to commit)
 * -------------------------------------------------------------
 * Copy this file to `config.local.js` and fill in your real
 * secrets. `config.local.js` is gitignored, so your credentials
 * stay out of version control.
 *
 *   cp config.local.example.js config.local.js   (macOS/Linux)
 *   copy config.local.example.js config.local.js (Windows)
 *
 * Loaded after config.js, it overrides values in window.APP_CONFIG.
 */
(function applyLocalOverrides() {
  if (!window.APP_CONFIG) return;

  // OpenSky basic-auth credentials (raises rate limits).
  window.APP_CONFIG.live.opensky.username = "YOUR_OPENSKY_USERNAME";
  window.APP_CONFIG.live.opensky.password = "YOUR_OPENSKY_PASSWORD";
})();
