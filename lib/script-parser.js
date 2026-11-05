'use strict';
/**
 * Haalt timers ("cues") uit een script/draaiboek.
 *
 * Ondersteunt: .txt/.md (vrije tekst), .csv/.tsv, .docx (Word), .xlsx (Excel)
 * en .json (export van deze app).
 *
 * Herkent o.a.:
 *   - tijdsduren met eenheid: "5 min", "5'", "2m30s", "1u30", "90 sec", "1,5 uur"
 *   - mm:ss / h:mm:ss in de tekst: "Intro (03:30)", "Duur: 1:05:00"
 *   - tijdsblokken: "20:00 - 20:15 Welkom"
 *   - draaiboeken met starttijden: "19:30 Deuren open" / "20:00 Welkom"
 *     → de duur is het verschil met de volgende starttijd
 *   - tabellen met kolommen als Titel / Duur / Start / Einde / Notities
 */
const { readZip } = require('./zip');
const { parseDuration, normalizeQuotes, UNIT_ALT } = require('../public/shared.js');

const LABEL = '(?:(?:duur|duration|lengte|length|looptijd|speeltijd|tijdsduur)\\s*[:=]?\\s*)?';
const NUM = '\\d+(?:[.,]\\d+)?';
const DUR_RE = new RegExp(
  `(?<![\\p{L}\\d.,:])${LABEL}(${NUM}\\s*(?:${UNIT_ALT})(?:\\s*(?:(?:en|and|&)\\s+)?${NUM}\\s*(?:${UNIT_ALT})){0,2}(?:\\s*\\d{1,2}(?![\\d:.,]))?)(?![\\p{L}\\d])`,
  'iu'
);
const MMSS_RE = new RegExp(`(?<![\\d:.])${LABEL}(\\d{1,3}:[0-5]\\d(?::[0-5]\\d)?)(?![\\d:])`, 'iu');
const HOUR = '([01]?\\d|2[0-3])';
const SEP = '[:.hu]';
const SUFFIX = '(?:\\s*(?:uur|u|h)(?![\\p{L}]))?';
const RANGE_RE = new RegExp(
  `(?<![\\d:.])${HOUR}${SEP}([0-5]\\d)${SUFFIX}\\s*(?:-|–|—|tot|to|till|until|>|→)\\s*${HOUR}${SEP}([0-5]\\d)${SUFFIX}(?![\\d:.])`,
  'iu'
);
const LEAD_CLOCK_RE = new RegExp(`^(\\s*(?:[-*•>]\\s*|\\d+[.)]\\s+)?)${HOUR}([:.hu])([0-5]\\d)(?![\\d:.])${SUFFIX}`, 'iu');

const MAX_NOTES = 2000;

// ---------------------------------------------------------------- helpers

function blank(str, index, length) {
  return str.slice(0, index) + ' '.repeat(length) + str.slice(index + length);
}

function clockToSec(h, m) {
  return (+h * 60 + +m) * 60;
}

function secToClock(sec) {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function clockStrToSec(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(str || '');
  return m ? clockToSec(m[1], m[2]) : null;
}

function tidy(part) {
  return part
    .replace(/\*\*|__|`/g, '')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—*•>|:;,.#=+~]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/[\s\-–—|:;,=([{+~]+$/, '')
    .replace(/^[)\]}]+\s*/, '')
    .trim();
}

function splitTitle(text) {
  const parts = text
    .split('\t')
    .map(tidy)
    .filter((p) => p && !/^\d+[.)]?$/.test(p));
  return { title: parts.shift() || '', extra: parts.join(' · ') };
}

function appendNote(cue, line) {
  const text = line.trim().replace(/\s*\t+\s*/g, ' · ');
  if (!text) return;
  if (cue.notes.length >= MAX_NOTES) return;
  cue.notes = (cue.notes ? cue.notes + '\n' : '') + text;
  if (cue.notes.length > MAX_NOTES) cue.notes = cue.notes.slice(0, MAX_NOTES - 1) + '…';
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('�')) text = buf.toString('latin1'); // Windows-1252-ish fallback
  return text;
}

// ------------------------------------------------------- schedule handling

/**
 * Vult ontbrekende duren aan met behulp van starttijden.
 * @param {Array} cues cues met .start (sec sinds middernacht) en .duration
 * @param {boolean} reinterpret als het géén draaiboek is: "05:00" als 5 minuten lezen
 */
function resolveSchedule(cues, reinterpret) {
  const withStart = cues.filter((c) => c.start != null);
  let increasing = 0;
  for (let i = 1; i < withStart.length; i++) {
    const diff = withStart[i].start - withStart[i - 1].start;
    if (diff >= 0 || diff < -12 * 3600) increasing++;
  }
  const isSchedule = withStart.length >= 2 && increasing >= Math.ceil((withStart.length - 1) * 0.7);

  let filled = 0;
  if (isSchedule) {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (c.duration != null || c.start == null) continue;
      if (c.end != null) {
        c.duration = (c.end - c.start + 86400) % 86400;
        filled++;
        continue;
      }
      const next = cues.slice(i + 1).find((n) => n.start != null);
      if (next) {
        let diff = next.start - c.start;
        if (diff < 0 && diff < -12 * 3600) diff += 86400;
        if (diff > 0) {
          c.duration = diff;
          filled++;
        }
      }
    }
  } else {
    for (const c of cues) {
      if (c.start == null) continue;
      if (c.end != null && c.duration == null) {
        c.duration = (c.end - c.start + 86400) % 86400;
        continue;
      }
      if (reinterpret && c.duration == null && (c.clockSep === ':' || /[uh]/i.test(c.clockSep || ''))) {
        // Geen draaiboek: "05:00 Intro" → 5 minuten, "1u30 Workshop" → 1,5 uur
        c.duration = c.clockSep === ':' ? c.start / 60 : c.start;
        c.start = null;
      }
    }
  }
  // true als starttijden gebruikt werden om duren te berekenen
  return isSchedule && filled > 0;
}

function finalize(cues) {
  return cues
    .filter((c) => c.title || c.duration != null)
    .map((c, i) => ({
      title: c.title || `Item ${i + 1}`,
      duration: c.duration != null ? Math.round(c.duration) : null,
      startTime: c.start != null ? secToClock(c.start) : '',
      notes: c.notes || '',
    }));
}

// ----------------------------------------------------------- text scripts

function parseLine(original) {
  let norm = normalizeQuotes(original);
  let line = original;
  const cue = { title: '', duration: null, start: null, end: null, notes: '', clockSep: null };
  let found = false;

  const cut = (m, idx = m.index, len = m[0].length) => {
    norm = blank(norm, idx, len);
    line = blank(line, idx, len);
  };

  const range = RANGE_RE.exec(norm);
  if (range) {
    cue.start = clockToSec(range[1], range[2]);
    cue.end = clockToSec(range[3], range[4]);
    cut(range);
    found = true;
  } else {
    const lead = LEAD_CLOCK_RE.exec(norm);
    if (lead) {
      cue.start = clockToSec(lead[2], lead[4]);
      cue.clockSep = lead[3];
      cut(lead, lead[1].length, lead[0].length - lead[1].length);
      found = true;
    }
  }

  const dur = DUR_RE.exec(norm);
  if (dur) {
    const secs = parseDuration(dur[1].replace(/\s+/g, ' '));
    // Meer dan 6 uur is vrijwel zeker geen duur van een onderdeel.
    if (secs != null && secs <= 6 * 3600) {
      cue.duration = secs;
      cut(dur);
      found = true;
    }
  }
  if (cue.duration == null) {
    const mmss = MMSS_RE.exec(norm);
    if (mmss) {
      cue.duration = parseDuration(mmss[1]);
      cut(mmss);
      found = true;
    }
  }

  if (!found) return null;
  const { title, extra } = splitTitle(line);
  cue.title = title;
  if (extra) cue.notes = extra;
  return cue;
}

function parseTextScript(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let current = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cue = parseLine(raw);
    if (cue) {
      cues.push(cue);
      current = cue;
    } else if (current) {
      appendNote(current, raw);
    }
  }
  const isSchedule = resolveSchedule(cues, true);
  return { cues: finalize(cues), isSchedule };
}

// --------------------------------------------------------------- tables

const ROLE_PATTERNS = [
  ['duration', /(duur|duration|lengte|length|looptijd|speeltijd|minuten|minutes|\bmins?\b)/i],
  ['end', /^(einde?|eindtijd|end|end ?time|tot|to|uit|out|stop)$/i],
  ['start', /^(start|starttijd|start ?time|begin|begintijd|aanvang|van|from|in|tijdstip|uur)$/i],
  ['time', /^(tijd|time)$/i],
  ['notes', /(notes?|notities?|opmerking|info|tekst|text|bericht|message|spreker|speaker|wie|who|comments?|remarks?|presentator|regie|cue ?tekst|details?)/i],
  ['title', /(titel|title|naam|name|item|onderdeel|segment|programma|omschrijving|beschrijving|description|act|cue|wat|inhoud|topic|onderwerp|rubriek)/i],
];

function cellString(cell, excel) {
  if (cell == null) return '';
  if (typeof cell === 'number') {
    if (excel && cell < 1 && cell > 0) {
      const secs = Math.round(cell * 86400);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      // Kleine waarden zijn waarschijnlijk een duur, grote een kloktijd.
      if (h < 6) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return String(cell);
  }
  return String(cell).trim();
}

function detectHeader(row) {
  const roles = {};
  row.forEach((cell, i) => {
    const text = String(cell ?? '').trim();
    if (!text || text.length > 40) return;
    for (const [role, re] of ROLE_PATTERNS) {
      if (re.test(text)) {
        if (role === 'notes') (roles.notes = roles.notes || []).push(i);
        else if (roles[role] == null) roles[role] = i;
        break;
      }
    }
  });
  const useful = roles.title != null || roles.duration != null || roles.start != null || roles.time != null;
  return useful ? roles : null;
}

function cellDuration(cell, excel) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    if (excel && cell > 0 && cell < 1) return Math.round(cell * 86400);
    return Math.round(cell * 60);
  }
  const str = String(cell).trim();
  const direct = parseDuration(str);
  if (direct != null) return direct;
  const m = DUR_RE.exec(normalizeQuotes(str)) || MMSS_RE.exec(str);
  return m ? parseDuration(m[1]) : null;
}

function cellClock(cell, excel) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    if (excel) return Math.round((cell % 1) * 86400);
    return null;
  }
  const m = new RegExp(`${HOUR}${SEP}([0-5]\\d)`, 'i').exec(String(cell));
  return m ? clockToSec(m[1], m[2]) : null;
}

function parseTable(rows, opts = {}) {
  const excel = !!opts.excel;
  rows = rows.filter((r) => r && r.some((c) => cellString(c, excel) !== ''));
  if (!rows.length) return { cues: [], isSchedule: false };

  const roles = detectHeader(rows[0]);
  if (!roles) {
    const text = rows.map((r) => r.map((c) => cellString(c, excel)).join('\t')).join('\n');
    return parseTextScript(text);
  }

  // "Tijd"-kolom: kloktijden die oplopen → start, anders duur.
  if (roles.time != null) {
    const values = rows.slice(1).map((r) => cellClock(r[roles.time], excel)).filter((v) => v != null);
    const looksLikeStart = values.length >= 2 && values.every((v, i) => i === 0 || v >= values[i - 1]) && values[0] >= 3600;
    if (looksLikeStart && roles.start == null) roles.start = roles.time;
    else if (roles.duration == null) roles.duration = roles.time;
  }

  const used = new Set([roles.title, roles.duration, roles.start, roles.end, ...(roles.notes || [])].filter((v) => v != null));
  const cues = [];
  for (const row of rows.slice(1)) {
    const cue = { title: '', duration: null, start: null, end: null, notes: '', clockSep: null };
    if (roles.duration != null) cue.duration = cellDuration(row[roles.duration], excel);
    if (roles.start != null) cue.start = cellClock(row[roles.start], excel);
    if (roles.end != null) cue.end = cellClock(row[roles.end], excel);
    if (roles.title != null) cue.title = tidy(cellString(row[roles.title], excel));
    if (!cue.title) {
      const firstFree = row.findIndex((c, i) => !used.has(i) && cellString(c, excel) && !/^\d+$/.test(cellString(c, excel)));
      if (firstFree >= 0) cue.title = tidy(cellString(row[firstFree], excel));
    }
    cue.notes = (roles.notes || [])
      .map((i) => cellString(row[i], excel))
      .filter(Boolean)
      .join(' · ')
      .slice(0, MAX_NOTES);
    if (cue.start != null && cue.end != null && cue.duration == null) {
      cue.duration = (cue.end - cue.start + 86400) % 86400;
    }
    if (!cue.title && cue.duration == null && cue.start == null) continue;
    cues.push(cue);
  }
  const isSchedule = resolveSchedule(cues, false);
  return { cues: finalize(cues), isSchedule };
}

function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';

  const rows = [];
  let row = [];
  let field = '';
  inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------- office files

function docxToText(buf) {
  const zip = readZip(buf);
  const xml = zip.readText('word/document.xml');
  if (!xml) throw new Error('Geen Word-document gevonden in dit bestand');

  const out = [];
  let line = '';
  let rowCells = null;
  let cell = '';
  let tableDepth = 0;
  let inText = false;
  const re = /<(\/?)w:(tbl|tr|tc|p|t|tab|br|cr)\b[^>]*?(\/?)>|([^<]+)|<[^>]*>/g;
  let m;
  const append = (s) => {
    if (rowCells) cell += s;
    else line += s;
  };
  while ((m = re.exec(xml))) {
    const [, closing, tag, selfClose, text] = m;
    if (text != null) {
      if (inText) append(decodeXml(text));
      continue;
    }
    if (!tag) continue;
    switch (tag) {
      case 'tbl':
        if (selfClose) break;
        tableDepth += closing ? -1 : 1;
        break;
      case 'tr':
        if (tableDepth > 1) break;
        if (!closing) rowCells = [];
        else if (rowCells) {
          out.push(rowCells.join('\t'));
          rowCells = null;
        }
        break;
      case 'tc':
        if (tableDepth > 1 || !rowCells) break;
        if (!closing) cell = '';
        else rowCells.push(cell.replace(/\s+/g, ' ').trim());
        break;
      case 'p':
        if (closing || selfClose) {
          if (rowCells) cell += ' ';
          else {
            out.push(line);
            line = '';
          }
        }
        break;
      case 't':
        inText = !closing && !selfClose;
        break;
      case 'tab':
        append(rowCells ? ' ' : '\t');
        break;
      case 'br':
      case 'cr':
        if (rowCells) cell += ' ';
        else {
          out.push(line);
          line = '';
        }
        break;
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}

function xlsxToRows(buf) {
  const zip = readZip(buf);
  const shared = [];
  const ss = zip.readText('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''));
    }
  }

  let sheetPath = null;
  const wb = zip.readText('xl/workbook.xml');
  const rels = zip.readText('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb);
    if (first) {
      const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${first[1]}"[^>]*>`).exec(rels);
      const target = rel && /Target="([^"]+)"/.exec(rel[0]);
      if (target) sheetPath = target[1].startsWith('/') ? target[1].slice(1) : `xl/${target[1].replace(/^\.\//, '')}`;
    }
  }
  if (!sheetPath || !zip.has(sheetPath)) {
    sheetPath = zip.names().filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  }
  const sheet = sheetPath && zip.readText(sheetPath);
  if (!sheet) throw new Error('Geen werkblad gevonden in dit Excel-bestand');

  const colIndex = (ref) => {
    const letters = /^[A-Z]+/.exec(ref || '');
    if (!letters) return null;
    let n = 0;
    for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    let auto = 0;
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      const idx = ref ? colIndex(ref[1]) : auto;
      auto = idx + 1;
      const type = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let value = null;
      if (type === 's') value = v ? shared[+v[1]] ?? '' : '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
      else if (type === 'str' || type === 'e') value = v ? decodeXml(v[1]) : '';
      else if (type === 'b') value = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
      else value = v ? Number(v[1]) : null;
      row[idx] = value;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? null : x)));
  }
  return rows;
}

// ----------------------------------------------------------------- entry

function looksLikeTabTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  return tabbed / lines.length >= 0.6;
}

/** Geplakte CSV-tabel met herkenbare kolomkoppen (bv. "Titel;Duur")? */
function looksLikeDelimitedTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  for (const delim of [';', ',']) {
    const header = lines[0].split(delim);
    if (header.length < 2 || !detectHeader(header)) continue;
    const withDelim = lines.filter((l) => l.includes(delim)).length;
    if (withDelim / lines.length >= 0.8) return true;
  }
  return false;
}

function fromJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.timers) ? data.timers : null;
  if (!list) throw new Error('JSON bevat geen lijst met timers');
  return list.map((t) => ({
    title: String(t.title || t.name || ''),
    duration: typeof t.duration === 'number' ? t.duration : parseDuration(t.duration),
    startTime: t.startTime || '',
    notes: String(t.notes || ''),
    mode: t.mode,
    target: t.target,
    warning: t.warning,
    danger: t.danger,
    autoNext: t.autoNext,
  }));
}

/**
 * @param {{filename?: string, buffer?: Buffer, text?: string}} input
 * @returns {{format: string, cues: Array, isSchedule: boolean, warnings: string[]}}
 */
function parseScript({ filename = '', buffer = null, text = null }) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename) || [])[1]?.toLowerCase() || '';
  const warnings = [];
  let result;
  let format;

  if (buffer && (ext === 'docx' || ext === 'docm')) {
    format = 'Word';
    result = parseTextScript(docxToText(buffer));
  } else if (buffer && (ext === 'xlsx' || ext === 'xlsm')) {
    format = 'Excel';
    result = parseTable(xlsxToRows(buffer), { excel: true });
  } else if (['doc', 'xls', 'pdf', 'pages', 'numbers', 'odt', 'ods', 'rtf'].includes(ext)) {
    throw new Error(
      `.${ext}-bestanden worden niet ondersteund. Bewaar het script als .docx, .xlsx, .csv of .txt (of kopieer de tekst en plak ze).`
    );
  } else {
    const str = text != null ? String(text) : decodeText(buffer || Buffer.alloc(0));
    if (ext === 'json' || (!ext && /^\s*[[{]/.test(str))) {
      format = 'JSON';
      result = { cues: fromJson(str), isSchedule: false };
    } else if (ext === 'csv' || ext === 'tsv') {
      format = ext.toUpperCase();
      result = parseTable(parseCsv(str));
    } else if (looksLikeTabTable(str)) {
      format = 'Tabel';
      result = parseTable(str.split(/\r?\n/).map((l) => l.split('\t')));
    } else if (looksLikeDelimitedTable(str)) {
      format = 'CSV';
      result = parseTable(parseCsv(str));
    } else {
      format = 'Tekst';
      result = parseTextScript(str);
    }
  }

  if (!result.cues.length) {
    warnings.push(
      'Er werden geen tijden gevonden. Zet bij elk onderdeel een duur (bv. "Welkom – 5 min" of "Intro (03:30)") of een starttijd (bv. "20:00 Welkom").'
    );
  }
  const missing = result.cues.filter((c) => c.duration == null).length;
  if (missing) warnings.push(`${missing} onderde${missing === 1 ? 'el heeft' : 'len hebben'} geen duur; vul die zelf in (standaard 5:00).`);
  if (result.isSchedule) warnings.push('Draaiboek met starttijden herkend: de duur is berekend tot de volgende starttijd.');

  return { format, cues: result.cues, isSchedule: !!result.isSchedule, warnings };
}

module.exports = { parseScript, parseTextScript, parseTable, parseCsv, docxToText, xlsxToRows };
