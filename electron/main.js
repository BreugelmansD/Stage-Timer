'use strict';
/**
 * Stage Timer als Mac-app (Electron).
 * Start de ingebouwde server en opent de bediening in een eigen venster.
 * Het scherm (de klok) opent op een tweede beeldscherm of projector.
 */
const { app, BrowserWindow, Menu, shell, dialog, screen, ipcMain, clipboard, powerSaveBlocker, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('../server.js');

const DEFAULT_CONFIG = { port: 3000, pin: '' };
const BG = '#01171c';

let config = { ...DEFAULT_CONFIG };
let port = null;
let controlWin = null;
let displayWin = null;
let settingsWin = null;
let displaySleepBlocker = null;
let quitting = false;

// ------------------------------------------------------------ instellingen

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(next) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
}

function baseUrl() {
  return `http://localhost:${port}`;
}

// ------------------------------------------------------------ server

async function startServer() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  let lastErr;
  // Probeer de ingestelde poort; is die bezet, dan de volgende.
  for (let p = config.port; p < config.port + 20 && p <= 65535; p++) {
    try {
      const res = await server.start({ port: p, pin: config.pin, dataDir });
      return res.port;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EADDRINUSE') break;
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------ vensters

function isOwnUrl(url) {
  return url.startsWith(baseUrl() + '/');
}

function handleLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url) && new URL(url).pathname === '/display') {
      openDisplay();
    } else if (isOwnUrl(url)) {
      shell.openExternal(url.replace('localhost', '127.0.0.1'));
    } else if (/^https?:/.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function createControlWindow() {
  if (controlWin) {
    controlWin.show();
    controlWin.focus();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  controlWin = new BrowserWindow({
    width: Math.min(1440, workArea.width),
    height: Math.min(940, workArea.height),
    minWidth: 760,
    minHeight: 560,
    title: 'Stage Timer',
    backgroundColor: BG,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  handleLinks(controlWin);
  controlWin.once('ready-to-show', () => controlWin.show());
  controlWin.on('closed', () => {
    controlWin = null;
  });
  controlWin.loadURL(`${baseUrl()}/`);
}

function externalDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().filter((d) => d.id !== primary.id);
}

function placeOnDisplay(win, display, fullscreen) {
  if (win.isFullScreen()) win.setFullScreen(false);
  const b = display.workArea;
  const w = Math.min(1280, b.width);
  const h = Math.min(720, b.height);
  win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2), width: w, height: h });
  if (fullscreen) setTimeout(() => win.setFullScreen(true), 150);
}

function openDisplay() {
  if (displayWin) {
    displayWin.show();
    displayWin.focus();
    return;
  }
  const ext = externalDisplays()[0];
  const target = ext || screen.getPrimaryDisplay();
  displayWin = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'Stage Timer – Scherm',
    backgroundColor: '#000000',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  handleLinks(displayWin);
  placeOnDisplay(displayWin, target, false);
  displayWin.once('ready-to-show', () => {
    displayWin.show();
    // Op een extra beeldscherm/projector meteen volledig scherm.
    if (ext) displayWin.setFullScreen(true);
  });
  displayWin.on('closed', () => {
    displayWin = null;
    if (displaySleepBlocker != null && powerSaveBlocker.isStarted(displaySleepBlocker)) powerSaveBlocker.stop(displaySleepBlocker);
    displaySleepBlocker = null;
    buildMenu();
  });
  // Scherm mag niet in slaap vallen zolang de klok getoond wordt.
  displaySleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  displayWin.loadURL(`${baseUrl()}/display`);
  buildMenu();
}

function moveDisplayToNextScreen() {
  if (!displayWin) return openDisplay();
  const all = screen.getAllDisplays();
  if (all.length < 2) {
    dialog.showMessageBox({ type: 'info', message: 'Er is maar één beeldscherm aangesloten.', detail: 'Sluit een extra scherm of projector aan om de klok daarop te tonen.' });
    return;
  }
  const current = screen.getDisplayMatching(displayWin.getBounds());
  const idx = all.findIndex((d) => d.id === current.id);
  placeOnDisplay(displayWin, all[(idx + 1) % all.length], true);
}

function openSettings() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 430,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Instellingen',
    backgroundColor: BG,
    parent: controlWin || undefined,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
}

// ------------------------------------------------------------ menu

function addressLines() {
  const ips = server.lanAddresses();
  if (!ips.length) return [`Geen netwerk gevonden. Op deze Mac: ${baseUrl()}/`];
  return ips.flatMap((ip) => [`Bediening: http://${ip}:${port}/`, `Scherm:    http://${ip}:${port}/display`]);
}

function showAddresses() {
  const lines = addressLines();
  dialog
    .showMessageBox({
      type: 'info',
      message: 'Verbinden vanaf een andere computer, tablet of telefoon',
      detail: `Open één van deze adressen in een browser op hetzelfde netwerk:\n\n${lines.join('\n')}${config.pin ? '\n\nDe bediening is beveiligd met een pincode.' : ''}`,
      buttons: ['Adres van de bediening kopiëren', 'Sluiten'],
      defaultId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        const ip = server.lanAddresses()[0];
        clipboard.writeText(ip ? `http://${ip}:${port}/` : `${baseUrl()}/`);
      }
    });
}

function runInControl(js) {
  createControlWindow();
  const exec = () => controlWin.webContents.executeJavaScript(js).catch(() => {});
  if (controlWin.webContents.isLoading()) controlWin.webContents.once('did-finish-load', exec);
  else exec();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Over Stage Timer' },
              { type: 'separator' },
              { label: 'Instellingen…', accelerator: 'Cmd+,', click: openSettings },
              { type: 'separator' },
              { role: 'services', label: 'Voorzieningen' },
              { type: 'separator' },
              { role: 'hide', label: 'Verberg Stage Timer' },
              { role: 'hideOthers', label: 'Verberg andere' },
              { role: 'unhide', label: 'Toon alles' },
              { type: 'separator' },
              { role: 'quit', label: 'Stop Stage Timer' },
            ],
          },
        ]
      : [{ label: 'Bestand', submenu: [{ label: 'Instellingen…', accelerator: 'Ctrl+,', click: openSettings }, { role: 'quit', label: 'Afsluiten' }] }]),
    {
      label: 'Wijzig',
      submenu: [
        { role: 'undo', label: 'Herstel' },
        { role: 'redo', label: 'Opnieuw' },
        { type: 'separator' },
        { role: 'cut', label: 'Knip' },
        { role: 'copy', label: 'Kopieer' },
        { role: 'paste', label: 'Plak' },
        { role: 'selectAll', label: 'Selecteer alles' },
      ],
    },
    {
      label: 'Scherm',
      submenu: [
        { label: displayWin ? 'Toon schermvenster' : 'Open scherm', accelerator: 'CmdOrCtrl+D', click: openDisplay },
        { label: 'Verplaats naar volgend beeldscherm', accelerator: 'CmdOrCtrl+Shift+D', click: moveDisplayToNextScreen },
        {
          label: 'Volledig scherm aan/uit',
          accelerator: 'CmdOrCtrl+Shift+F',
          enabled: !!displayWin,
          click: () => displayWin && displayWin.setFullScreen(!displayWin.isFullScreen()),
        },
        { type: 'separator' },
        { label: 'Bediening', accelerator: 'CmdOrCtrl+1', click: createControlWindow },
      ],
    },
    {
      label: 'Netwerk',
      submenu: [
        { label: 'Adressen voor andere toestellen…', accelerator: 'CmdOrCtrl+N', click: showAddresses },
        { label: 'Bediening openen in browser', click: () => shell.openExternal(`http://127.0.0.1:${port}/`) },
        { label: 'Scherm openen in browser', click: () => shell.openExternal(`http://127.0.0.1:${port}/display`) },
        { type: 'separator' },
        { label: `Poort ${port} wijzigen…`, click: openSettings },
      ],
    },
    {
      label: 'Weergave',
      submenu: [
        { role: 'reload', label: 'Herlaad' },
        { role: 'resetZoom', label: 'Ware grootte' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom uit' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Volledig scherm' },
        { role: 'toggleDevTools', label: 'Ontwikkelaarstools' },
      ],
    },
    { role: 'windowMenu', label: 'Venster' },
    {
      role: 'help',
      label: 'Help',
      submenu: [
        { label: 'Uitleg over Stage Timer', accelerator: 'CmdOrCtrl+?', click: () => runInControl("document.getElementById('btnHelp').click()") },
        { label: 'Gegevensmap tonen in Finder', click: () => shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------ instellingenvenster (IPC)

ipcMain.handle('settings:get', () => ({ ...config, activePort: port, addresses: server.lanAddresses() }));
ipcMain.handle('settings:save', async (_e, next) => {
  const p = Number(next.port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) return { ok: false, error: 'Kies een poort tussen 1024 en 65535 (bv. 3000 of 8080).' };
  const pin = String(next.pin || '').trim().slice(0, 32);
  config = { ...config, port: p, pin };
  saveConfig(config);
  const { response } = await dialog.showMessageBox(settingsWin || undefined, {
    type: 'question',
    message: 'Instellingen bewaard',
    detail: 'Stage Timer moet opnieuw starten om de nieuwe poort of pincode te gebruiken. Andere toestellen moeten daarna het nieuwe adres openen.',
    buttons: ['Nu opnieuw starten', 'Later'],
    defaultId: 0,
  });
  if (response === 0) {
    quitting = true;
    await server.stop();
    app.relaunch();
    app.exit(0);
  }
  return { ok: true };
});

// ------------------------------------------------------------ opstarten

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createControlWindow());

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    app.setAboutPanelOptions({
      applicationName: 'Stage Timer',
      applicationVersion: app.getVersion(),
      copyright: '© BLUE MOON bv',
      credits: 'Stage timer met bediening via het netwerk.',
    });
    config = loadConfig();
    try {
      port = await startServer();
    } catch (err) {
      dialog.showErrorBox('Stage Timer kon niet starten', server.portErrorMessage(err, config.port));
      app.exit(1);
      return;
    }
    // Voorkom dat macOS de app "in slaap" zet terwijl hij als server werkt.
    powerSaveBlocker.start('prevent-app-suspension');
    buildMenu();
    createControlWindow();
    if (port !== config.port) {
      dialog.showMessageBox(controlWin, {
        type: 'warning',
        message: `Poort ${config.port} was bezet`,
        detail: `Stage Timer draait nu op poort ${port}. Wil je een vaste poort, kies die dan via Stage Timer → Instellingen.`,
      });
    }
  });

  app.on('activate', () => {
    if (port) createControlWindow();
  });

  // Op de Mac blijft de app (en de server) actief als je de vensters sluit,
  // zodat bedieningen op andere toestellen blijven werken.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (e) => {
    if (quitting || !port) return;
    e.preventDefault();
    quitting = true;
    server.stop().finally(() => app.quit());
  });
}
