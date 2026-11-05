'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/shared.js');

test('parseDuration herkent veel notaties', () => {
  const cases = {
    '5': 300,
    '1,5': 90,
    '5:30': 330,
    '1:02:03': 3723,
    '5 min': 300,
    '5 minuten': 300,
    '2m30s': 150,
    '1u30': 5400,
    '1 uur en 30 minuten': 5400,
    '1h 30m': 5400,
    '90 sec': 90,
    "5'30\"": 330,
    '5’': 300,
    '1,5 uur': 5400,
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(S.parseDuration(input), want, input);
  for (const bad of ['', 'abc', '5mx', '5 30', 'min']) assert.equal(S.parseDuration(bad), null, bad);
});

test('formatTime', () => {
  assert.equal(S.formatTime(65), '01:05');
  assert.equal(S.formatTime(3725), '1:02:05');
  assert.equal(S.formatTime(-7), '-00:07');
  assert.equal(S.formatTime(65, 'hms'), '00:01:05');
  assert.equal(S.formatTime(3725, 'ms'), '62:05');
  assert.equal(S.formatTime(61, 'm'), "2'");
});

test('timerView berekent resterende tijd en fase', () => {
  const timer = { id: 'a', title: 'A', mode: 'countdown', duration: 120, warning: 60, danger: 10 };
  const state = { timers: [timer], activeId: 'a', run: { running: true, startedAt: 1000, elapsed: 0 } };
  let v = S.timerView(state, 1000);
  assert.equal(v.seconds, 120);
  assert.equal(v.phase, 'normal');
  v = S.timerView(state, 1000 + 61000);
  assert.equal(v.seconds, 59);
  assert.equal(v.phase, 'warning');
  v = S.timerView(state, 1000 + 115000);
  assert.equal(v.phase, 'danger');
  v = S.timerView(state, 1000 + 125000);
  assert.equal(v.seconds, -5);
  assert.equal(v.phase, 'overtime');
});

test('timerView optellen en pauze', () => {
  const timer = { id: 'a', title: 'A', mode: 'countup', duration: 0, warning: 0, danger: 0 };
  const state = { timers: [timer], activeId: 'a', run: { running: false, startedAt: 0, elapsed: 42500 } };
  assert.equal(S.timerView(state, 999999).seconds, 42);
});
