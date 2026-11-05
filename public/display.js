/* Schermweergave: toont de actieve timer, titel, klok, voortgang en berichten. */
(function () {
  'use strict';
  const S = window.StageShared;
  const C = window.StageClient;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const params = new URLSearchParams(location.search);
  const preview = params.has('preview');
  if (preview) body.classList.add('preview');

  const el = {
    title: $('title'),
    clock: $('clock'),
    time: $('time'),
    notes: $('notes'),
    progress: $('progress'),
    bar: $('bar'),
    next: $('next'),
    message: $('message'),
    messageText: $('messageText'),
    center: $('center'),
  };

  let state = null;
  let lastText = '';
  let lastLen = -1;

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function toggle(node, show) {
    node.classList.toggle('hidden-el', !show);
  }

  function applySettings(s) {
    const root = document.documentElement.style;
    root.setProperty('--bg', s.bgColor);
    root.setProperty('--text', s.textColor);
    root.setProperty('--timer-color', s.timerColor);
    root.setProperty('--font', s.customFont ? `${s.customFont}, ${s.fontFamily}` : s.fontFamily);
    root.setProperty('--weight', s.fontWeight);
    root.setProperty('--title-size', `${s.titleSize}vw`);
    root.setProperty('--msg-color', s.messageColor);
    root.setProperty('--msg-bg', s.messageBg);
    root.setProperty('--msg-size', `${s.messageSize}vw`);
    body.classList.toggle('mirror', !!s.mirror);
    body.classList.toggle('color-bg', !!s.colorBackground);
    body.classList.remove('msg-top', 'msg-center', 'msg-bottom');
    body.classList.add(`msg-${s.messagePosition}`);
    lastLen = -1; // opnieuw passend maken
  }

  function render() {
    if (!state) return;
    const s = state.settings;
    const now = C.now();
    const view = S.timerView(state, now);
    const t = view.timer;

    // Titel, klok, volgende
    toggle(el.title, s.showTitle && !!t);
    setText(el.title, t ? t.title : '');
    toggle(el.clock, s.showClock);
    setText(el.clock, S.formatClock(now, s.clockSeconds));
    const next = S.nextTimer(state);
    toggle(el.next, s.showNext && !!next);
    setText(el.next, next ? `Volgende: ${next.title}` : '');
    toggle(el.notes, s.showNotes && !!(t && t.notes));
    setText(el.notes, t && s.showNotes ? t.notes : '');

    // Tijd
    let text;
    if (!t) text = '--:--';
    else if (view.mode === 'clock') text = S.formatClock(now, true);
    else {
      let secs = view.seconds;
      if (!s.showOvertime && secs < 0) secs = 0;
      text = S.formatTime(secs, s.timerFormat);
    }
    if (text !== lastText) {
      el.time.textContent = text;
      lastText = text;
      if (text.length !== lastLen) {
        lastLen = text.length;
        fit();
      }
    }

    // Kleur volgens fase
    const colors = {
      warning: s.warningColor,
      danger: s.dangerColor,
      overtime: s.overtimeColor,
    };
    const phaseColor = colors[view.phase] || s.timerColor;
    const root = document.documentElement.style;
    root.setProperty('--phase-color', phaseColor);
    root.setProperty('--phase-bg', colors[view.phase] || s.bgColor);
    body.classList.toggle('idle', view.phase === 'idle');
    body.classList.toggle('flash-time', view.phase === 'overtime' && s.overtimeFlash && s.showOvertime);

    // Voortgang
    toggle(el.progress, s.showProgress && view.progress != null);
    if (view.progress != null) el.bar.style.width = `${(view.progress * 100).toFixed(2)}%`;

    // Bericht & blackout
    const m = state.message;
    body.classList.toggle('has-message', !!(m.visible && m.text));
    body.classList.toggle('msg-flash', !!(m.visible && m.flash));
    setText(el.messageText, m.text);
    body.classList.toggle('blackout', !!state.blackout);
  }

  // Maak de timer zo groot als ingesteld, maar nooit breder/hoger dan het scherm.
  function fit() {
    if (!state) return;
    const s = state.settings;
    const box = el.center.getBoundingClientRect();
    let size = (window.innerWidth * s.timerSize) / 100;
    el.time.style.fontSize = `${size}px`;
    const w = el.time.scrollWidth;
    const h = el.time.offsetHeight;
    const scale = Math.min(1, (box.width * 0.96) / (w || 1), (box.height * 0.95) / (h || 1));
    if (scale < 1) el.time.style.fontSize = `${Math.floor(size * scale)}px`;
  }

  C.onState((st) => {
    const settingsChanged = !state || JSON.stringify(state.settings) !== JSON.stringify(st.settings);
    state = st;
    if (settingsChanged) applySettings(st.settings);
    render();
    if (settingsChanged) requestAnimationFrame(fit);
  });
  C.onConnection((ok) => body.classList.toggle('disconnected', !ok));

  window.addEventListener('resize', () => {
    lastLen = -1;
    fit();
  });
  if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(el.center);

  setInterval(render, 100);

  // Volledig scherm & cursor verbergen
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  if (!preview) {
    document.addEventListener('dblclick', toggleFullscreen);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
    let idle;
    const wake = () => {
      body.classList.remove('hide-cursor');
      clearTimeout(idle);
      idle = setTimeout(() => body.classList.add('hide-cursor'), 2500);
    };
    document.addEventListener('mousemove', wake);
    wake();
    setTimeout(() => $('hint').classList.add('hidden'), 4000);
  }

  C.connect();
})();
