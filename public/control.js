/* Bediening: timers beheren, live aansturen, berichten sturen, weergave aanpassen, scripts inladen. */
(function () {
  'use strict';
  const S = window.StageShared;
  const C = window.StageClient;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let lastListKey = '';

  // ------------------------------------------------------------ helpers

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 5000 : 2500);
  }

  async function cmd(type, payload) {
    try {
      return await C.command(type, payload);
    } catch (err) {
      toast(err.message, true);
      throw err;
    }
  }
  const send = (type, payload) => cmd(type, payload).catch(() => {});

  const MODE_LABEL = { countdown: 'Aftellen', countup: 'Optellen', target: 'Tot tijdstip', clock: 'Klok' };

  // ------------------------------------------------------------ pincode

  C.setPinHandler(
    () =>
      new Promise((resolve) => {
        const dlg = $('pinDialog');
        $('pinInput').value = '';
        $('pinError').classList.toggle('hidden', !dlg.dataset.tried);
        dlg.dataset.tried = '1';
        dlg.returnValue = '';
        dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('pinInput').value : null);
        dlg.showModal();
      })
  );

  // ------------------------------------------------------------ live

  function renderLive() {
    if (!state) return;
    const view = S.timerView(state, C.now());
    const t = view.timer;
    const box = $('liveBox');
    box.className = `live-box phase-${view.phase}`;
    $('liveTitle').textContent = t ? t.title : 'Geen timer geselecteerd';
    let text = '--:--';
    if (t) text = view.mode === 'clock' ? S.formatClock(C.now(), true) : S.formatTime(view.seconds, state.settings.timerFormat);
    const live = $('liveTime');
    if (live.textContent !== text) live.textContent = text;
    $('liveBar').style.width = view.progress != null ? `${(view.progress * 100).toFixed(1)}%` : '0';

    const btn = $('btnToggle');
    const label = view.running && t && t.mode !== 'target' ? '⏸ Pauze' : '▶ Start';
    if (btn.textContent !== label) btn.textContent = label;
  }

  function renderLiveStatic() {
    const t = S.activeTimer(state);
    const i = state.timers.findIndex((x) => x.id === state.activeId);
    $('liveIndex').textContent = i >= 0 ? `${i + 1} / ${state.timers.length}` : '';
    const next = S.nextTimer(state);
    $('liveNext').textContent = next ? `Volgende: ${next.title}` : t ? 'Laatste timer' : '';
    $('liveNotesWrap').classList.toggle('hidden', !(t && t.notes));
    $('liveNotes').textContent = t ? t.notes : '';
    $('btnBlackout').classList.toggle('on', !!state.blackout);
    $('btnPrev').disabled = i <= 0;
    $('btnNext').disabled = i < 0 || i >= state.timers.length - 1;
  }

  $('btnToggle').onclick = () => send('toggle');
  $('btnReset').onclick = () => send('reset');
  $('btnNext').onclick = () => send('next');
  $('btnPrev').onclick = () => send('prev');
  $('btnBlackout').onclick = () => send('blackout');
  document.querySelectorAll('[data-adjust]').forEach((b) => {
    b.onclick = () => send('adjust', { seconds: Number(b.dataset.adjust) });
  });

  // Voorbeeld van het scherm
  const preview = $('preview');
  const previewWrap = $('previewWrap');
  function scalePreview() {
    preview.style.transform = `scale(${previewWrap.clientWidth / 1920})`;
  }
  function setPreview(on) {
    previewWrap.classList.toggle('hidden', !on);
    if (on && !preview.src) preview.src = '/display?preview=1';
    if (!on) preview.removeAttribute('src');
    if (on) scalePreview();
    C.storage((s) => s.setItem('stageTimerPreview', on ? '1' : '0'));
  }
  $('chkPreview').checked = C.storage((s) => s.getItem('stageTimerPreview'), '1') !== '0';
  $('chkPreview').onchange = (e) => setPreview(e.target.checked);
  if (window.ResizeObserver) new ResizeObserver(scalePreview).observe(previewWrap);
  setPreview($('chkPreview').checked);

  // ------------------------------------------------------------ timerlijst

  function renderList() {
    const key = JSON.stringify([state.timers, state.activeId, state.run.running]);
    if (key === lastListKey) return;
    lastListKey = key;

    const list = $('timerList');
    $('emptyList').classList.toggle('hidden', state.timers.length > 0);
    const total = state.timers.filter((t) => t.mode === 'countdown' || t.mode === 'countup').reduce((a, t) => a + t.duration, 0);
    $('totalTime').textContent = state.timers.length ? `${state.timers.length} timers · totaal ${S.formatDuration(total)}` : '';

    list.innerHTML = state.timers
      .map((t, i) => {
        const active = t.id === state.activeId;
        const meta = [
          t.startTime && `🕒 ${esc(t.startTime)}`,
          t.mode !== 'countdown' && MODE_LABEL[t.mode] + (t.mode === 'target' && t.target ? ` ${esc(t.target)}` : ''),
          t.autoNext && '⤵ auto',
          t.notes && esc(t.notes.split('\n')[0]),
        ].filter(Boolean);
        const dur = t.mode === 'clock' ? '🕒' : t.mode === 'target' ? esc(t.target || '—') : S.formatDuration(t.duration);
        return `<li class="timer-item${active ? ' active' : ''}${active && state.run.running ? ' running' : ''}" draggable="true" data-id="${t.id}">
          <span class="idx" title="Slepen om te verplaatsen">${i + 1}</span>
          <div class="main">
            <div class="t-title">${esc(t.title)}</div>
            ${meta.length ? `<div class="t-meta">${meta.join(' · ')}</div>` : ''}
          </div>
          <span class="dur">${dur}</span>
          <span class="actions">
            <button data-act="play" title="Laden en starten">▶</button>
            <button data-act="up" title="Omhoog"${i === 0 ? ' disabled' : ''}>↑</button>
            <button data-act="down" title="Omlaag"${i === state.timers.length - 1 ? ' disabled' : ''}>↓</button>
            <button data-act="edit" title="Bewerken">✎</button>
            <button data-act="dup" title="Dupliceren">⧉</button>
            <button data-act="del" title="Verwijderen">✕</button>
          </span>
        </li>`;
      })
      .join('');
  }

  $('timerList').addEventListener('click', (e) => {
    const li = e.target.closest('.timer-item');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('button')?.dataset.act;
    const index = state.timers.findIndex((t) => t.id === id);
    switch (act) {
      case 'play':
        return send('timer.select', { id, start: true });
      case 'up':
        return send('timer.move', { id, to: index - 1 });
      case 'down':
        return send('timer.move', { id, to: index + 1 });
      case 'edit':
        return openTimerDialog(state.timers[index]);
      case 'dup':
        return send('timer.duplicate', { id });
      case 'del':
        if (confirm(`"${state.timers[index].title}" verwijderen?`)) send('timer.delete', { id });
        return;
      default:
        if (id !== state.activeId) send('timer.select', { id });
    }
  });
  $('timerList').addEventListener('dblclick', (e) => {
    const li = e.target.closest('.timer-item');
    if (li && !e.target.closest('button')) openTimerDialog(state.timers.find((t) => t.id === li.dataset.id));
  });

  // Slepen om te herschikken
  let dragId = null;
  const list = $('timerList');
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.timer-item');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  list.addEventListener('dragend', () => {
    dragId = null;
    list.querySelectorAll('.timer-item').forEach((li) => li.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const li = e.target.closest('.timer-item');
    if (!li) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    list.querySelectorAll('.timer-item').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', (e) => {
    const li = e.target.closest('.timer-item');
    if (!dragId || !li) return;
    e.preventDefault();
    const from = state.timers.findIndex((t) => t.id === dragId);
    let to = state.timers.findIndex((t) => t.id === li.dataset.id);
    const r = li.getBoundingClientRect();
    if (e.clientY > r.top + r.height / 2) to++;
    if (from < to) to--;
    if (from !== to) send('timer.move', { id: dragId, to });
  });

  $('btnAdd').onclick = () => openTimerDialog(null);
  $('btnClear').onclick = () => {
    if (state.timers.length && confirm('Alle timers verwijderen?')) send('timers.clear');
  };
  $('btnExport').onclick = () => {
    const data = { app: 'stage-timer', version: 1, exported: new Date().toISOString(), timers: state.timers, settings: state.settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stage-timers-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ------------------------------------------------------------ timer dialoog

  const timerForm = $('timerForm');
  const F = timerForm.elements;
  let editingId = null;

  const MODE_HELP = {
    countdown: 'Telt af van de duur naar 0 en daarna (optioneel) negatief verder.',
    countup: 'Telt op vanaf 0. Met een duur verschijnen waarschuwingskleuren en een voortgangsbalk.',
    target: 'Telt af tot een vast tijdstip (bv. 20:00 aanvang). De duur bepaalt enkel de voortgangsbalk.',
    clock: 'Toont de huidige tijd groot op het scherm.',
  };

  function updateModeFields() {
    const mode = F.mode.value;
    timerForm.querySelectorAll('[data-for]').forEach((el) => {
      el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(mode));
    });
    $('modeHelp').textContent = MODE_HELP[mode];
  }
  F.mode.onchange = updateModeFields;

  function openTimerDialog(t) {
    editingId = t ? t.id : null;
    $('timerDialogTitle').textContent = t ? 'Timer bewerken' : 'Nieuwe timer';
    const v = t || { title: '', mode: 'countdown', duration: 300, target: '', warning: 60, danger: 15, notes: '', startTime: '', autoNext: false };
    F.title.value = v.title;
    F.mode.value = v.mode;
    F.duration.value = S.formatDuration(v.duration);
    F.target.value = v.target;
    F.warning.value = S.formatDuration(v.warning);
    F.danger.value = S.formatDuration(v.danger);
    F.notes.value = v.notes;
    F.startTime.value = v.startTime || '';
    F.autoNext.checked = !!v.autoNext;
    updateModeFields();
    $('timerDialog').showModal();
    F.title.focus();
    F.title.select();
  }

  timerForm.addEventListener('submit', (e) => {
    const submitter = e.submitter;
    if (!submitter || submitter.value !== 'save') return;
    const fields = { duration: 'Duur', warning: 'Waarschuwing', danger: 'Bijna op' };
    const parsed = {};
    for (const [name, label] of Object.entries(fields)) {
      const raw = F[name].value.trim();
      parsed[name] = raw === '' ? 0 : S.parseDuration(raw);
      if (parsed[name] == null && !F[name].closest('.hidden')) {
        e.preventDefault();
        toast(`${label}: "${raw}" is geen geldige tijd (bv. 5:00 of 5 min)`, true);
        F[name].focus();
        return;
      }
    }
    if (F.mode.value === 'target' && !F.target.value) {
      e.preventDefault();
      toast('Kies een tijdstip', true);
      return;
    }
    const timer = {
      title: F.title.value.trim() || 'Timer',
      mode: F.mode.value,
      duration: parsed.duration ?? 300,
      target: F.target.value,
      warning: parsed.warning ?? 60,
      danger: parsed.danger ?? 15,
      notes: F.notes.value,
      startTime: F.startTime.value.trim(),
      autoNext: F.autoNext.checked,
    };
    if (editingId) send('timer.update', { id: editingId, patch: timer });
    else send('timer.add', { timer });
  });

  // ------------------------------------------------------------ bericht

  const DEFAULT_PRESETS = ['Nog 5 minuten', 'Nog 1 minuut', 'Gelieve af te ronden', 'Tijd is om', 'Luider spreken a.u.b.', 'Trager spreken', 'Micro staat uit', 'Kijk naar de regie'];
  let presets = C.storage((s) => JSON.parse(s.getItem('stageTimerPresets') || 'null'), null) || DEFAULT_PRESETS.slice();

  function renderPresets() {
    $('presets').innerHTML = presets
      .map((p, i) => `<button class="preset" data-i="${i}">${esc(p)}<span class="x" data-del="${i}" title="Verwijderen">✕</span></button>`)
      .join('');
    C.storage((s) => s.setItem('stageTimerPresets', JSON.stringify(presets)));
  }
  $('presets').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      presets.splice(Number(del.dataset.del), 1);
      renderPresets();
      return;
    }
    const b = e.target.closest('.preset');
    if (!b) return;
    const text = presets[Number(b.dataset.i)];
    $('msgText').value = text;
    send('message.set', { text, visible: true, flash: $('msgFlash').checked });
  };
  $('presetForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('presetInput').value.trim();
    if (!v) return;
    presets.push(v);
    $('presetInput').value = '';
    renderPresets();
  };
  renderPresets();

  $('btnMsgShow').onclick = () => {
    const text = $('msgText').value.trim();
    if (!text) return toast('Typ eerst een bericht', true);
    send('message.set', { text, visible: true, flash: $('msgFlash').checked });
  };
  $('btnMsgHide').onclick = () => send('message.set', { visible: false });
  $('msgText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('btnMsgShow').click();
    }
  });
  $('msgFlash').onchange = () => {
    if (state && state.message.visible) send('message.set', { flash: $('msgFlash').checked });
  };

  function renderMessage() {
    const m = state.message;
    $('msgLive').classList.toggle('hidden', !m.visible);
    $('msgLiveText').textContent = m.text;
  }

  // ------------------------------------------------------------ tabs

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab.dataset.tab}`));
    };
  });

  // ------------------------------------------------------------ weergave-instellingen

  const settingsForm = $('settingsForm');
  let settingsTimer = null;
  let pendingPatch = {};

  function renderSettings() {
    const s = state.settings;
    for (const el of settingsForm.elements) {
      if (!el.name || !(el.name in s) || el === document.activeElement) continue;
      if (el.type === 'checkbox') el.checked = !!s[el.name];
      else if (String(el.value) !== String(s[el.name])) {
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(s[el.name]))) {
          el.add(new Option(String(s[el.name]), String(s[el.name])));
        }
        el.value = s[el.name];
      }
    }
  }

  settingsForm.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.name) return;
    pendingPatch[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.name === 'fontWeight' ? Number(el.value) : el.value;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      const patch = pendingPatch;
      pendingPatch = {};
      send('settings.update', { patch });
    }, 120);
  });
  $('btnResetSettings').onclick = () => {
    if (confirm('Alle weergave-instellingen terugzetten?')) send('settings.reset');
  };

  // ------------------------------------------------------------ script import

  const importDlg = $('importDialog');
  let importCues = [];

  function resetImport() {
    importCues = [];
    $('fileInput').value = '';
    $('fileName').textContent = '';
    $('importInfo').textContent = '';
    $('importRows').innerHTML = '';
    $('importTableWrap').classList.add('hidden');
    $('btnImportAppend').disabled = true;
    $('btnImportReplace').disabled = true;
  }

  $('btnImport').onclick = () => {
    resetImport();
    importDlg.showModal();
  };
  $('btnImportCancel').onclick = () => importDlg.close();

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function analyse(body, label) {
    $('importInfo').textContent = 'Bezig met analyseren…';
    try {
      const res = await C.parseScript(body);
      importCues = res.cues.map((c) => ({ ...c, include: true }));
      const parts = [`${label}: ${res.cues.length} timer${res.cues.length === 1 ? '' : 's'} gevonden (${res.format}).`, ...res.warnings];
      $('importInfo').innerHTML = parts.map(esc).join('<br>');
      renderImportRows();
    } catch (err) {
      $('importInfo').innerHTML = `<span class="error">${esc(err.message)}</span>`;
      importCues = [];
      renderImportRows();
    }
  }

  async function handleFile(file) {
    if (!file) return;
    $('fileName').textContent = file.name;
    if (file.size > 20 * 1024 * 1024) return toast('Bestand is te groot (max. 20 MB)', true);
    const data = await readAsBase64(file);
    analyse({ filename: file.name, data }, file.name);
  }

  $('fileInput').onchange = (e) => handleFile(e.target.files[0]);
  const dz = $('dropZone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    handleFile(e.dataTransfer.files[0]);
  });
  $('btnParsePaste').onclick = () => {
    const text = $('pasteText').value;
    if (!text.trim()) return toast('Plak eerst tekst', true);
    analyse({ text, filename: '' }, 'Geplakte tekst');
  };

  function renderImportRows() {
    $('importTableWrap').classList.toggle('hidden', importCues.length === 0);
    $('importRows').innerHTML = importCues
      .map(
        (c, i) => `<tr data-i="${i}" class="${c.include ? '' : 'off'}">
          <td><input type="checkbox" data-f="include" ${c.include ? 'checked' : ''} /></td>
          <td class="c-start">${esc(c.startTime)}</td>
          <td><input type="text" data-f="title" value="${esc(c.title)}" /></td>
          <td class="c-dur"><input type="text" data-f="duration" value="${c.duration != null ? S.formatDuration(c.duration) : ''}" placeholder="5:00" class="${c.duration == null ? 'missing' : ''}" /></td>
          <td class="c-notes" title="${esc(c.notes)}">${esc(c.notes)}</td>
        </tr>`
      )
      .join('');
    updateImportButtons();
  }

  function updateImportButtons() {
    const any = importCues.some((c) => c.include);
    $('btnImportAppend').disabled = !any;
    $('btnImportReplace').disabled = !any;
    $('importAll').checked = importCues.length > 0 && importCues.every((c) => c.include);
  }

  $('importRows').addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    const c = importCues[Number(tr.dataset.i)];
    const f = e.target.dataset.f;
    if (f === 'include') {
      c.include = e.target.checked;
      tr.classList.toggle('off', !c.include);
      updateImportButtons();
    } else if (f === 'title') c.title = e.target.value;
    else if (f === 'duration') {
      c.duration = S.parseDuration(e.target.value);
      e.target.classList.toggle('missing', c.duration == null);
    }
  });
  $('importAll').onchange = (e) => {
    importCues.forEach((c) => (c.include = e.target.checked));
    renderImportRows();
  };

  async function doImport(replace) {
    const timers = importCues
      .filter((c) => c.include)
      .map((c) => ({
        title: c.title,
        duration: c.duration ?? 300,
        startTime: c.startTime,
        notes: c.notes,
        ...(c.mode ? { mode: c.mode } : {}),
        ...(c.target ? { target: c.target } : {}),
        ...(c.warning != null ? { warning: c.warning } : {}),
        ...(c.danger != null ? { danger: c.danger } : {}),
        ...(c.autoNext ? { autoNext: true } : {}),
      }));
    if (replace && state.timers.length && !confirm(`De huidige ${state.timers.length} timers vervangen door ${timers.length} nieuwe?`)) return;
    try {
      await cmd('timers.import', { timers, replace });
      importDlg.close();
      toast(`${timers.length} timers ingeladen`);
    } catch {
      /* toast al getoond */
    }
  }
  $('btnImportAppend').onclick = () => doImport(false);
  $('btnImportReplace').onclick = () => doImport(true);

  // ------------------------------------------------------------ help

  async function openHelp() {
    $('helpDialog').showModal();
    try {
      const info = await (await fetch('/api/info')).json();
      const hosts = info.addresses.length ? info.addresses : [location.hostname];
      $('helpUrls').innerHTML = hosts
        .map((h) => `<div>Scherm: <code>http://${esc(h)}:${info.port}/display</code> · Bediening: <code>http://${esc(h)}:${info.port}/</code></div>`)
        .join('');
    } catch {
      $('helpUrls').textContent = 'Klik op 🌐 Netwerk om de adressen te zien.';
    }
  }
  $('btnHelp').onclick = openHelp;
  $('btnHelpClose').onclick = () => $('helpDialog').close();
  // Toon de uitleg automatisch bij het allereerste bezoek.
  if (!C.storage((s) => s.getItem('stageTimerHelpSeen'), '1')) {
    C.storage((s) => s.setItem('stageTimerHelpSeen', '1'));
    setTimeout(openHelp, 300);
  }

  // ------------------------------------------------------------ netwerk

  $('btnNetwork').onclick = async () => {
    const box = $('networkList');
    box.innerHTML = '<p class="muted">Laden…</p>';
    $('networkDialog').showModal();
    try {
      const info = await (await fetch('/api/info')).json();
      const hosts = info.addresses.length ? info.addresses : [location.hostname];
      box.innerHTML =
        hosts
          .map((h) => {
            const base = `http://${h}:${info.port}`;
            return `<div class="net-row">
              <div class="url"><span class="muted small">Scherm</span><code>${esc(base)}/display</code><button data-copy="${esc(base)}/display">Kopiëren</button></div>
              <div class="url"><span class="muted small">Bediening</span><code>${esc(base)}/</code><button data-copy="${esc(base)}/">Kopiëren</button></div>
            </div>`;
          })
          .join('') +
        `<p class="muted small">Computernaam: ${esc(info.hostname)}${info.pinRequired ? ' · bediening beveiligd met pincode' : ''}</p>`;
    } catch {
      box.innerHTML = '<p class="error">Kon netwerkinformatie niet ophalen.</p>';
    }
  };
  $('networkList').onclick = async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('Gekopieerd');
    } catch {
      prompt('Kopieer dit adres:', b.dataset.copy);
    }
  };
  $('btnNetworkClose').onclick = () => $('networkDialog').close();

  // ------------------------------------------------------------ sneltoetsen

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = {
      ' ': () => send('toggle'),
      ArrowRight: () => send('next'),
      ArrowLeft: () => send('prev'),
      r: () => send('reset'),
      b: () => send('blackout'),
      '+': () => send('adjust', { seconds: 60 }),
      '=': () => send('adjust', { seconds: 60 }),
      '-': () => send('adjust', { seconds: -60 }),
      m: () => state && send('message.set', { visible: !state.message.visible }),
      '?': () => openHelp(),
    };
    const fn = map[e.key] || map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });

  // ------------------------------------------------------------ start

  C.onState((st) => {
    state = st;
    renderLiveStatic();
    renderList();
    renderMessage();
    renderSettings();
    renderLive();
  });
  C.onConnection((ok) => {
    const pill = $('connStatus');
    pill.textContent = ok ? 'Verbonden' : 'Geen verbinding';
    pill.classList.toggle('off', !ok);
  });
  setInterval(renderLive, 100);
  C.connect();

  // Vraag meteen de pincode als die vereist is.
  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      if (info.pinRequired) C.checkPin().catch(() => {});
    })
    .catch(() => {});
})();
