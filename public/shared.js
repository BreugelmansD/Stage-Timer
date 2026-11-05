/*
 * Gedeelde logica voor server én browser: tijdsduur parsen/formatteren en
 * de huidige toestand van de actieve timer berekenen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StageShared = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODES = ['countdown', 'countup', 'target', 'clock'];

  const UNIT_ALT =
    "uren|uur|hours|hour|hrs|hr|u|h|minuten|minuut|minutes|minute|mins|min|m|''|'|seconden|seconde|seconds|second|secs|sec|s|\"";

  function unitFactor(unit) {
    if (!unit) return null;
    if (/^(uren|uur|hours?|hrs?|u|h)$/.test(unit)) return 3600;
    if (/^(minuten|minuut|minutes?|mins?|m|')$/.test(unit)) return 60;
    return 1; // seconden, s, sec, '' of "
  }

  /** Normaliseer typografische aanhalingstekens (zelfde lengte behouden). */
  function normalizeQuotes(s) {
    return String(s).replace(/[’‘′`´]/g, "'").replace(/[”“″]/g, '"');
  }

  /**
   * Zet een tijdsduur om naar seconden. Geeft null terug als het niet lukt.
   * Voorbeelden: "5" (minuten), "5:30", "1:02:03", "5 min", "2m30s", "1u30",
   * "1h 30m", "90 sec", "5'30\"", "1,5 uur".
   */
  function parseDuration(input) {
    if (input == null) return null;
    if (typeof input === 'number') return isFinite(input) && input >= 0 ? Math.round(input * 60) : null;
    const s = normalizeQuotes(input).trim().toLowerCase().replace(/,/g, '.');
    if (!s) return null;

    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);

    const clock = s.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (clock) {
      if (clock[3] != null) return +clock[1] * 3600 + +clock[2] * 60 + +clock[3];
      return +clock[1] * 60 + +clock[2];
    }

    const tok = new RegExp(`\\s*(?:(?:en|and|&)\\s+)?(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})?`, 'y');
    let pos = 0;
    let total = 0;
    let lastFactor = null;
    let count = 0;
    while (pos < s.length) {
      tok.lastIndex = pos;
      const m = tok.exec(s);
      if (!m || m[0].length === 0) break;
      const value = parseFloat(m[1]);
      let factor = unitFactor(m[2]);
      if (factor == null) {
        // Losse waarde na een eenheid: "1u30" = 1u30min, "5'30" = 5min30s.
        if (lastFactor === 3600) factor = 60;
        else if (lastFactor === 60) factor = 1;
        else return null;
      }
      total += value * factor;
      lastFactor = factor;
      count++;
      pos = tok.lastIndex;
      // Na een eenheid mag geen letter of cijfer volgen (bv. "5mx").
      if (m[2] && /[a-z]/.test(s[pos] || '') && /[a-z]$/.test(m[2])) return null;
      if (!m[2]) break;
    }
    if (count === 0 || s.slice(pos).trim() !== '') return null;
    return Math.round(total);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Formatteer seconden. format: 'auto' | 'hms' | 'ms' | 'm'
   */
  function formatTime(totalSeconds, format) {
    const neg = totalSeconds < 0;
    const t = Math.abs(Math.trunc(totalSeconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    let out;
    switch (format) {
      case 'hms':
        out = `${pad(h)}:${pad(m)}:${pad(s)}`;
        break;
      case 'ms':
        out = `${pad(Math.floor(t / 60))}:${pad(s)}`;
        break;
      case 'm':
        out = `${Math.ceil(t / 60)}'`;
        break;
      default:
        out = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }
    return (neg ? '-' : '') + out;
  }

  /** Korte notatie voor lijsten: "5:00", "1:30:00". */
  function formatDuration(seconds) {
    if (seconds == null || !isFinite(seconds)) return '';
    const t = Math.max(0, Math.round(seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** "20:15" of "20:15:30" → Date-tijdstip vandaag (lokale tijd) in ms. */
  function targetEpoch(target, now) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(target || '').trim());
    if (!m) return null;
    const d = new Date(now);
    d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
    return d.getTime();
  }

  function formatClock(now, withSeconds) {
    const d = new Date(now);
    const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
  }

  function activeTimer(state) {
    if (!state || !state.timers) return null;
    return state.timers.find((t) => t.id === state.activeId) || null;
  }

  function nextTimer(state) {
    if (!state || !state.timers) return null;
    const i = state.timers.findIndex((t) => t.id === state.activeId);
    return i >= 0 ? state.timers[i + 1] || null : null;
  }

  function elapsedMs(run, now) {
    if (!run) return 0;
    return run.elapsed + (run.running ? Math.max(0, now - run.startedAt) : 0);
  }

  /**
   * Bereken wat er nu getoond moet worden.
   * Geeft { timer, mode, seconds, remainingMs, progress, phase, running } terug.
   * phase: 'idle' | 'normal' | 'warning' | 'danger' | 'overtime'
   */
  function timerView(state, now) {
    const timer = activeTimer(state);
    const run = (state && state.run) || { running: false, elapsed: 0, startedAt: 0 };
    const view = {
      timer,
      mode: timer ? timer.mode : 'none',
      seconds: 0,
      remainingMs: null,
      progress: null,
      phase: 'idle',
      running: !!run.running,
    };
    if (!timer) return view;

    const elapsed = elapsedMs(run, now);
    let remainingMs = null;

    switch (timer.mode) {
      case 'clock':
        view.phase = 'normal';
        return view;
      case 'countup': {
        view.seconds = Math.floor(Math.max(0, elapsed) / 1000);
        if (timer.duration > 0) {
          remainingMs = timer.duration * 1000 - elapsed;
          view.progress = Math.min(1, Math.max(0, elapsed / (timer.duration * 1000)));
        }
        break;
      }
      case 'target': {
        const target = targetEpoch(timer.target, now);
        if (target == null) {
          view.phase = 'normal';
          return view;
        }
        remainingMs = target - now;
        view.running = true;
        if (timer.duration > 0) {
          view.progress = Math.min(1, Math.max(0, 1 - remainingMs / (timer.duration * 1000)));
        }
        break;
      }
      default: {
        remainingMs = timer.duration * 1000 - elapsed;
        view.progress = timer.duration > 0 ? Math.min(1, Math.max(0, elapsed / (timer.duration * 1000))) : 1;
      }
    }

    if (timer.mode !== 'countup') {
      view.seconds = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : -Math.floor(-remainingMs / 1000);
    }
    view.remainingMs = remainingMs;

    if (remainingMs == null) view.phase = 'normal';
    else if (remainingMs <= 0) view.phase = 'overtime';
    else if (remainingMs <= (timer.danger || 0) * 1000) view.phase = 'danger';
    else if (remainingMs <= (timer.warning || 0) * 1000) view.phase = 'warning';
    else view.phase = 'normal';

    if (!view.running && timer.mode !== 'target' && elapsed === 0) view.phase = view.phase === 'normal' ? 'idle' : view.phase;
    return view;
  }

  return {
    MODES,
    UNIT_ALT,
    normalizeQuotes,
    parseDuration,
    formatTime,
    formatDuration,
    formatClock,
    targetEpoch,
    activeTimer,
    nextTimer,
    elapsedMs,
    timerView,
  };
});
