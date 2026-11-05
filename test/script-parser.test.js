'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseScript } = require('../lib/script-parser');

const simple = (cues) => cues.map((c) => [c.title, c.duration]);

test('vrije tekst met verschillende duurnotaties', () => {
  const text = `# Gala
1. Welkom door presentator – 3 min
Jan komt op en heet iedereen welkom.
2. Speech burgemeester (05:00)
3. Band: The Foo - 12'30"
Pauze 15 minuten
Prijsuitreiking 1u30
Duur: 4:00 Slotwoord
Afsluiting 90 sec`;
  const r = parseScript({ text });
  assert.deepEqual(simple(r.cues), [
    ['Welkom door presentator', 180],
    ['Speech burgemeester', 300],
    ['Band: The Foo', 750],
    ['Pauze', 900],
    ['Prijsuitreiking', 5400],
    ['Slotwoord', 240],
    ['Afsluiting', 90],
  ]);
  assert.equal(r.cues[0].notes, 'Jan komt op en heet iedereen welkom.');
});

test('draaiboek met starttijden en tijdsblok', () => {
  const r = parseScript({ text: '19:30 Deuren open\n20:00 Welkom\n20.05u Speech\n20:20 - 20:50 Band\n21:00 Einde' });
  assert.deepEqual(simple(r.cues), [
    ['Deuren open', 1800],
    ['Welkom', 300],
    ['Speech', 900],
    ['Band', 1800],
    ['Einde', null],
  ]);
  assert.equal(r.cues[0].startTime, '19:30');
  assert.ok(r.isSchedule);
});

test('lijst met mm:ss vooraan is geen draaiboek', () => {
  const r = parseScript({ text: '05:00 Intro\n03:30 Lied 1\n04:15 Lied 2' });
  assert.deepEqual(simple(r.cues), [['Intro', 300], ['Lied 1', 210], ['Lied 2', 255]]);
});

test('tekst zonder tijden geeft een waarschuwing', () => {
  const r = parseScript({ text: 'Hallo\nIn de jaren 90\'s was alles beter' });
  assert.equal(r.cues.length, 0);
  assert.equal(r.warnings.length, 1);
});

test('CSV met kolomkoppen (puntkomma, aanhalingstekens, start/einde)', () => {
  const text = 'Titel;Start;Einde;Notities\nOpening;20:00;20:10;Jan\n"Pauze; lang";20:10;20:30;\n';
  const r = parseScript({ filename: 'x.csv', text });
  assert.deepEqual(simple(r.cues), [['Opening', 600], ['Pauze; lang', 1200]]);
  assert.equal(r.cues[0].notes, 'Jan');
});

test('geplakte tabel uit Excel (tabs)', () => {
  const r = parseScript({ text: 'Titel\tDuur\tSpreker\nOpening\t5:00\tJan\nKeynote\t20 min\tAn' });
  assert.deepEqual(simple(r.cues), [['Opening', 300], ['Keynote', 1200]]);
  assert.equal(r.cues[1].notes, 'An');
});

test('Word-document (.docx) met alinea\'s en tabel', () => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/script.docx'));
  const r = parseScript({ filename: 'script.docx', buffer });
  assert.equal(r.format, 'Word');
  assert.deepEqual(simple(r.cues), [
    ['Welkom door de presentator', 180],
    ['Speech burgemeester', 300],
    ['Band & dans', 720],
    ['Prijsuitreiking', 5400],
    ['Slotwoord', 240],
  ]);
  assert.equal(r.cues[2].notes, 'The Foo');
});

test('Excel (.xlsx) met tijdwaarden', () => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/rundown.xlsx'));
  const r = parseScript({ filename: 'rundown.xlsx', buffer });
  assert.equal(r.format, 'Excel');
  assert.deepEqual(simple(r.cues), [['Opening', 600], ['Keynote', 1500], ['Q&A', 900]]);
  assert.equal(r.cues[1].startTime, '20:10');
  assert.equal(r.cues[2].notes, 'Micro in zaal');
});

test('JSON-export van de app', () => {
  const text = JSON.stringify({ timers: [{ title: 'A', duration: 60, mode: 'countup' }] });
  const r = parseScript({ filename: 'x.json', text });
  assert.equal(r.cues[0].title, 'A');
  assert.equal(r.cues[0].duration, 60);
  assert.equal(r.cues[0].mode, 'countup');
});

test('niet-ondersteunde formaten geven een duidelijke fout', () => {
  assert.throws(() => parseScript({ filename: 'x.pdf', buffer: Buffer.from('x') }), /niet ondersteund/);
});
