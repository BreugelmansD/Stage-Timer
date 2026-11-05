'use strict';
/**
 * Stage Timer — server
 *
 * Start met:  node server.js
 * Opties (omgevingsvariabelen):
 *   PORT=3000              poort
 *   HOST=0.0.0.0           luister-adres (0.0.0.0 = bereikbaar op het netwerk)
 *   STAGE_TIMER_PIN=1234   optionele pincode voor de bediening
 *   DATA_DIR=./data        waar de toestand bewaard wordt
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const shared = require('./public/shared.js');
const { parseScript } = require('./lib/script-parser');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PIN = process.env.STAGE_TIMER_PIN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 25 * 1024 * 1024;

// ------------------------------------------------------------------ state

const DEFAULT_SETTINGS = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  customFont: '',
  fontWeight: 700,
  timerSize: 24,
  timerFormat: 'auto',
  timerColor: '#ffffff',
  warningColor: '#ffc400',
  dangerColor: '#ff3b30',
  overtimeColor: '#ff3b30',
  bgColor: '#000000',
  textColor: '#d0d0d0',
  colorBackground: false,
  overtimeFlash: true,
  showOvertime: true,
  showTitle: true,
  titleSize: 4,
  showNext: false,
  showProgress: true,
  showClock: true,
  clockSeconds: false,
  showNotes: false,
  messageColor: '#ffffff',
  messageBg: '#1f4fd1',
  messageSize: 6,
  messagePosition: 'bottom',
  mirror: false,
};

const SETTING_CHOICES = {
  timerFormat: ['auto', 'hms', 'ms', 'm'],
  messagePosition: ['bottom', 'top', 'center'],
};

const SETTING_RANGES = {
  fontWeight: [100, 900],
  timerSize: [4, 60],
  titleSize: [1, 20],
  messageSize: [1, 30],
};

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function str(v, max) {
  return v == null ? '' : String(v).slice(0, max);
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toSeconds(v, fallback) {
  if (typeof v === 'number') return isFinite(v) ? v : fallback;
  const parsed = shared.parseDuration(v);
  return parsed == null ? fallback : parsed;
}

function makeTimer(input = {}, base = {}) {
  const src = { ...base, ...input };
  const mode = shared.MODES.includes(src.mode) ? src.mode : 'countdown';
  const target = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(src.target || '').trim()) ? String(src.target).trim() : '';
  return {
    id: base.id || newId(),
    title: str(src.title, 200).trim() || 'Timer',
    mode,
    duration: clampInt(toSeconds(src.duration, 300), 0, 359999, 300),
    target,
    warning: clampInt(toSeconds(src.warning, 60), 0, 86400, 60),
    danger: clampInt(toSeconds(src.danger, 15), 0, 86400, 15),
    notes: str(src.notes, 5000),
    startTime: str(src.startTime, 8),
    autoNext: !!src.autoNext,
  };
}

function sanitizeSettings(patch, current = DEFAULT_SETTINGS) {
  const out = { ...current };
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (typeof def === 'boolean') out[key] = !!v;
    else if (typeof def === 'number') {
      const [min, max] = SETTING_RANGES[key] || [0, 1000];
      const n = Number(v);
      if (isFinite(n)) out[key] = Math.min(max, Math.max(min, n));
    } else if (SETTING_CHOICES[key]) {
      if (SETTING_CHOICES[key].includes(v)) out[key] = v;
    } else if (/Color$|Bg$/.test(key)) {
      if (/^#[0-9a-f]{6}$/i.test(String(v))) out[key] = String(v);
    } else {
      out[key] = str(v, 300).replace(/[;{}<>]/g, '');
    }
  }
  return out;
}

function freshRun() {
  return { running: false, startedAt: 0, elapsed: 0 };
}

let state = {
  timers: [],
  activeId: null,
  run: freshRun(),
  message: { text: '', visible: false, flash: false },
  blackout: false,
  settings: { ...DEFAULT_SETTINGS },
  rev: 0,
};

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state.timers = Array.isArray(raw.timers) ? raw.timers.map((t) => makeTimer(t, { id: t.id })) : [];
    state.activeId = state.timers.some((t) => t.id === raw.activeId) ? raw.activeId : state.timers[0]?.id || null;
    if (raw.run && typeof raw.run === 'object') {
      state.run = {
        running: !!raw.run.running,
        startedAt: Number(raw.run.startedAt) || 0,
        elapsed: Number(raw.run.elapsed) || 0,
      };
    }
    if (raw.message) {
      state.message = { text: str(raw.message.text, 500), visible: !!raw.message.visible, flash: !!raw.message.flash };
    }
    state.blackout = !!raw.blackout;
    state.settings = sanitizeSettings(raw.settings, DEFAULT_SETTINGS);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Kon opgeslagen toestand niet lezen:', err.message);
    if (!state.timers.length) {
      state.timers = [
        makeTimer({ title: 'Welkom', duration: 300 }),
        makeTimer({ title: 'Spreker 1', duration: 900, warning: 120, danger: 30 }),
        makeTimer({ title: 'Pauze', duration: 900 }),
      ];
      state.activeId = state.timers[0].id;
    }
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STATE_FILE + '.tmp';
      const { rev, ...data } = state;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.warn('Kon toestand niet opslaan:', err.message);
    }
  }, 300);
}

// --------------------------------------------------------------- realtime

const clients = new Set();

function publicState() {
  return { ...state, serverNow: Date.now(), pinRequired: !!PIN };
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(payload);
}

function changed() {
  state.rev++;
  broadcast();
  persist();
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

// --------------------------------------------------------------- commands

function indexOfActive() {
  return state.timers.findIndex((t) => t.id === state.activeId);
}

function pauseRun(now) {
  if (state.run.running) {
    state.run.elapsed += now - state.run.startedAt;
    state.run.running = false;
  }
}

function select(id, keepRunning) {
  const now = Date.now();
  state.activeId = id;
  state.run = freshRun();
  if (keepRunning && id) {
    state.run.running = true;
    state.run.startedAt = now;
  }
}

function step(delta) {
  if (!state.timers.length) return;
  const i = indexOfActive();
  const j = i < 0 ? 0 : i + delta;
  if (j < 0 || j >= state.timers.length) return;
  select(state.timers[j].id, state.run.running);
}

function handleCommand(cmd) {
  const now = Date.now();
  const type = cmd && cmd.type;
  const active = shared.activeTimer(state);

  switch (type) {
    // ---- bediening
    case 'start':
      if (!active) {
        if (!state.timers.length) return;
        select(state.timers[0].id, false);
      }
      if (!state.run.running) {
        state.run.running = true;
        state.run.startedAt = now;
      }
      break;
    case 'pause':
      pauseRun(now);
      break;
    case 'toggle':
      return handleCommand({ type: state.run.running ? 'pause' : 'start' });
    case 'reset':
      state.run = freshRun();
      break;
    case 'restart':
      state.run = { running: true, startedAt: now, elapsed: 0 };
      break;
    case 'next':
      step(1);
      break;
    case 'prev':
      step(-1);
      break;
    case 'adjust': {
      const secs = Number(cmd.seconds) || 0;
      if (!active || !secs) return;
      if (active.mode === 'countdown') state.run.elapsed -= secs * 1000;
      else if (active.mode === 'countup') {
        const cur = shared.elapsedMs(state.run, now);
        state.run.elapsed += Math.max(-cur, secs * 1000);
      } else return;
      break;
    }
    case 'timer.select':
      if (!state.timers.some((t) => t.id === cmd.id)) return;
      select(cmd.id, !!cmd.start);
      break;

    // ---- lijst
    case 'timer.add': {
      const t = makeTimer(cmd.timer);
      const at = Number.isInteger(cmd.index) ? cmd.index : state.timers.length;
      state.timers.splice(Math.max(0, Math.min(at, state.timers.length)), 0, t);
      if (!state.activeId) select(t.id, false);
      break;
    }
    case 'timer.update': {
      const i = state.timers.findIndex((t) => t.id === cmd.id);
      if (i < 0) return;
      state.timers[i] = makeTimer(cmd.patch || {}, state.timers[i]);
      break;
    }
    case 'timer.duplicate': {
      const i = state.timers.findIndex((t) => t.id === cmd.id);
      if (i < 0) return;
      const copy = makeTimer({ ...state.timers[i], title: state.timers[i].title + ' (kopie)' });
      state.timers.splice(i + 1, 0, copy);
      break;
    }
    case 'timer.delete': {
      const i = state.timers.findIndex((t) => t.id === cmd.id);
      if (i < 0) return;
      state.timers.splice(i, 1);
      if (state.activeId === cmd.id) {
        const next = state.timers[i] || state.timers[i - 1];
        select(next ? next.id : null, false);
      }
      break;
    }
    case 'timer.move': {
      const from = state.timers.findIndex((t) => t.id === cmd.id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(state.timers.length - 1, Number(cmd.to)));
      if (!isFinite(to) || to === from) return;
      const [t] = state.timers.splice(from, 1);
      state.timers.splice(to, 0, t);
      break;
    }
    case 'timers.import': {
      if (!Array.isArray(cmd.timers)) return;
      const list = cmd.timers.slice(0, 1000).map((t) => makeTimer(t));
      if (cmd.replace) {
        state.timers = list;
        select(list[0] ? list[0].id : null, false);
      } else {
        state.timers.push(...list);
        if (!state.activeId && list[0]) select(list[0].id, false);
      }
      break;
    }
    case 'timers.clear':
      state.timers = [];
      select(null, false);
      break;

    // ---- bericht & scherm
    case 'message.set': {
      const m = state.message;
      if ('text' in cmd) m.text = str(cmd.text, 500);
      if ('visible' in cmd) m.visible = !!cmd.visible;
      if ('flash' in cmd) m.flash = !!cmd.flash;
      if (!m.text.trim()) m.visible = false;
      break;
    }
    case 'blackout':
      state.blackout = 'on' in cmd ? !!cmd.on : !state.blackout;
      break;
    case 'settings.update':
      state.settings = sanitizeSettings(cmd.patch, state.settings);
      break;
    case 'settings.reset':
      state.settings = { ...DEFAULT_SETTINGS };
      break;
    default:
      throw Object.assign(new Error(`Onbekend commando: ${type}`), { status: 400 });
  }
  changed();
}

// Automatisch doorgaan naar de volgende timer (als ingesteld).
setInterval(() => {
  const active = shared.activeTimer(state);
  if (!active || !active.autoNext || !state.run.running) return;
  if (active.mode !== 'countdown' && active.mode !== 'countup') return;
  const view = shared.timerView(state, Date.now());
  if (view.remainingMs != null && view.remainingMs <= 0) {
    const i = indexOfActive();
    if (i >= 0 && i < state.timers.length - 1) {
      select(state.timers[i + 1].id, true);
      changed();
    }
  }
}, 200);

// ------------------------------------------------------------------- http

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Bestand is te groot'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('Ongeldige JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function pinOk(req) {
  if (!PIN) return true;
  const given = Buffer.from(String(req.headers['x-pin'] || ''));
  const want = Buffer.from(PIN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function serveStatic(req, res, pathname) {
  const routes = { '/': 'control.html', '/control': 'control.html', '/display': 'display.html', '/scherm': 'display.html' };
  const rel = routes[pathname] || pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Niet gevonden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  try {
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 1000\n\n');
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (pathname === '/api/time') return sendJson(res, 200, { now: Date.now() });
    if (pathname === '/api/state' && req.method === 'GET') return sendJson(res, 200, publicState());
    if (pathname === '/api/info' && req.method === 'GET') {
      return sendJson(res, 200, { port: PORT, addresses: lanAddresses(), pinRequired: !!PIN, hostname: os.hostname() });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      if (!pinOk(req)) return sendJson(res, 401, { error: 'Pincode vereist of onjuist' });
      const body = await readBody(req);

      if (pathname === '/api/auth') return sendJson(res, 200, { ok: true });
      if (pathname === '/api/command') {
        handleCommand(body);
        return sendJson(res, 200, { ok: true, rev: state.rev });
      }
      if (pathname === '/api/script/parse') {
        const buffer = body.data ? Buffer.from(String(body.data), 'base64') : null;
        const result = parseScript({ filename: str(body.filename, 300), buffer, text: body.text ?? null });
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: 'Onbekend adres' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    res.writeHead(405).end();
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message || String(err) });
  }
});

loadState();
server.listen(PORT, HOST, () => {
  const addrs = lanAddresses();
  const line = '─'.repeat(60);
  console.log(line);
  console.log(' Stage Timer draait!');
  console.log(line);
  console.log(` Op deze computer:   bediening  http://localhost:${PORT}/`);
  console.log(`                     scherm     http://localhost:${PORT}/display`);
  for (const a of addrs) {
    console.log(` Via het netwerk:    bediening  http://${a}:${PORT}/`);
    console.log(`                     scherm     http://${a}:${PORT}/display`);
  }
  if (PIN) console.log(' Pincode voor de bediening is ingeschakeld.');
  console.log(line);
  console.log(' Stoppen: Ctrl+C');
});

module.exports = { handleCommand, makeTimer, sanitizeSettings };
