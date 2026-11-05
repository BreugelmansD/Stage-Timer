/* Verbinding met de server: live toestand (Server-Sent Events), kloksynchronisatie en commando's. */
(function () {
  'use strict';
  const stateListeners = [];
  const connListeners = [];
  let state = null;
  let offset = 0;
  let synced = false;
  let connected = false;
  let pinHandler = null;

  function storage(fn, fallback) {
    try {
      return fn(window.localStorage);
    } catch {
      return fallback;
    }
  }

  function now() {
    return Date.now() + offset;
  }

  // Bepaal het verschil tussen de klok van deze computer en die van de server.
  async function syncClock() {
    let best = null;
    for (let i = 0; i < 5; i++) {
      try {
        const t0 = Date.now();
        const r = await fetch('/api/time', { cache: 'no-store' });
        const { now: server } = await r.json();
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, offset: server - (t0 + t1) / 2 };
      } catch {
        /* opnieuw bij volgende ronde */
      }
    }
    if (best) {
      offset = best.offset;
      synced = true;
    }
  }

  function setConnected(v) {
    if (v === connected) return;
    connected = v;
    connListeners.forEach((f) => f(v));
  }

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('state', (e) => {
      state = JSON.parse(e.data);
      if (!synced) offset = state.serverNow - Date.now();
      setConnected(true);
      stateListeners.forEach((f) => f(state));
    });
    es.onopen = () => {
      setConnected(true);
      syncClock();
    };
    es.onerror = () => setConnected(false);
  }

  function getPin() {
    return storage((s) => s.getItem('stageTimerPin') || '', '');
  }

  function setPin(pin) {
    storage((s) => s.setItem('stageTimerPin', pin));
  }

  async function post(url, body, retry = true) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pin': getPin() },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && retry && pinHandler) {
      const pin = await pinHandler();
      if (pin != null) {
        setPin(pin);
        return post(url, body, true);
      }
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Fout ${r.status}`);
    return data;
  }

  window.StageClient = {
    now,
    connect,
    getState: () => state,
    isConnected: () => connected,
    onState: (f) => stateListeners.push(f),
    onConnection: (f) => connListeners.push(f),
    command: (type, payload = {}) => post('/api/command', { type, ...payload }),
    parseScript: (body) => post('/api/script/parse', body),
    checkPin: () => post('/api/auth', {}),
    setPinHandler: (f) => (pinHandler = f),
    setPin,
    storage,
  };

  setInterval(syncClock, 60000);
})();
