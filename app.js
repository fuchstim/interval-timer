'use strict';

const $ = (id) => document.getElementById(id);

const setupScreen = $('setup');
const timerScreen = $('timer');
const form = $('setup-form');
const inWork = $('in-work');
const inPause = $('in-pause');
const inReps = $('in-reps');
const totalLabel = $('total-label');
const repLabel = $('rep-label');
const phaseLabel = $('phase-label');
const timeLabel = $('time-label');
const btnPause = $('btn-pause');
const btnReset = $('btn-reset');
const ringFg = $('ring-fg');
const keepAlive = $('keepalive');

const RING_C = 2 * Math.PI * 90; // circumference of the r=90 SVG circle
const SETTINGS_KEY = 'interval-timer-settings';

let state = 'idle'; // idle | running | paused | done
let segments = [];
let segIdx = 0;
let segEnd = 0; // performance.now() timestamp when the current segment ends
let pausedRemaining = 0; // ms left in the current segment while paused
let tickHandle = null;
let totalReps = 0;

/* ---------- settings ---------- */

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s) {
      inWork.value = s.work;
      inPause.value = s.pause;
      inReps.value = s.reps;
    }
  } catch (e) { /* corrupted or unavailable storage — keep defaults */ }
}

function readSettings() {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
  return {
    work: clamp(inWork.value, 1, 3600),
    pause: clamp(inPause.value, 1, 3600),
    reps: clamp(inReps.value, 1, 99),
  };
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateTotalPreview() {
  const { work, pause, reps } = readSettings();
  totalLabel.textContent = `Total: ${fmt((work + pause) * reps)}`;
}

/* ---------- audio ---------- */

let audioCtx = null;

// Must be called from a user gesture so mobile browsers allow sound later.
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
  // Silent looping <audio> keeps the iOS audio session in "playback" mode so
  // Web Audio beeps sound even when the ringer switch is on silent.
  keepAlive.play().catch(() => {});
}

function beep(count) {
  if (navigator.vibrate) {
    const pattern = [];
    for (let i = 0; i < count; i++) {
      if (i) pattern.push(100);
      pattern.push(150);
    }
    navigator.vibrate(pattern);
  }
  if (!audioCtx) return;
  if (audioCtx.state !== 'running') audioCtx.resume();
  const t0 = audioCtx.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const start = t0 + i * 0.28;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.7, start + 0.015);
    gain.gain.setValueAtTime(0.7, start + 0.13);
    gain.gain.linearRampToValueAtTime(0.0001, start + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  }
}

/* ---------- wake lock (keep the screen on while a workout runs) ---------- */

let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* denied (e.g. battery saver) — timer still works */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

/* ---------- timer engine ---------- */

function buildSegments({ work, pause, reps }) {
  const segs = [];
  for (let rep = 1; rep <= reps; rep++) {
    segs.push({ type: 'work', dur: work * 1000, rep });
    segs.push({ type: 'pause', dur: pause * 1000, rep });
  }
  return segs;
}

function start(settings) {
  segments = buildSegments(settings);
  totalReps = settings.reps;
  segIdx = 0;
  segEnd = performance.now() + segments[0].dur;
  setState('running');
}

function tick() {
  const now = performance.now();
  // Catch up across segment boundaries; anchors each segment to the previous
  // end time so the schedule never drifts, even if ticks were throttled.
  while (state === 'running' && now >= segEnd) {
    const isLast = segIdx === segments.length - 1;
    beep(isLast ? 3 : segments[segIdx].type === 'work' ? 1 : 2);
    segIdx += 1;
    if (segIdx >= segments.length) {
      setState('done');
      return;
    }
    segEnd += segments[segIdx].dur;
  }
  render();
}

function setState(next) {
  state = next;
  setupScreen.classList.toggle('hidden', next !== 'idle');
  timerScreen.classList.toggle('hidden', next === 'idle');

  if (next === 'running') {
    if (!tickHandle) tickHandle = setInterval(tick, 100);
  } else if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }

  if (next === 'running' || next === 'paused') acquireWakeLock();
  else releaseWakeLock();

  btnPause.textContent =
    next === 'paused' ? 'Resume' :
    next === 'done' ? 'Restart' : 'Pause';

  if (next === 'idle') {
    keepAlive.pause();
    delete document.body.dataset.phase;
    updateTotalPreview();
  } else {
    render();
  }
}

function render() {
  if (state === 'idle') return;

  if (state === 'done') {
    document.body.dataset.phase = 'done';
    repLabel.textContent = `Round ${totalReps} / ${totalReps}`;
    phaseLabel.textContent = 'Done';
    timeLabel.textContent = '0:00';
    ringFg.style.strokeDashoffset = 0;
    return;
  }

  const seg = segments[segIdx];
  const remaining = state === 'paused'
    ? pausedRemaining
    : Math.max(0, segEnd - performance.now());

  document.body.dataset.phase = seg.type;
  repLabel.textContent = `Round ${seg.rep} / ${totalReps}`;
  phaseLabel.textContent = state === 'paused'
    ? 'Paused'
    : (seg.type === 'work' ? 'Work' : 'Pause');
  timeLabel.textContent = fmt(Math.ceil(remaining / 1000));
  ringFg.style.strokeDashoffset = RING_C * (1 - remaining / seg.dur);
}

/* ---------- events ---------- */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const settings = readSettings();
  saveSettings(settings);
  unlockAudio();
  start(settings);
});

form.addEventListener('input', updateTotalPreview);

btnPause.addEventListener('click', () => {
  if (state === 'running') {
    pausedRemaining = Math.max(0, segEnd - performance.now());
    setState('paused');
  } else if (state === 'paused') {
    unlockAudio();
    segEnd = performance.now() + pausedRemaining;
    setState('running');
  } else if (state === 'done') {
    unlockAudio();
    start(readSettings());
  }
});

btnReset.addEventListener('click', () => setState('idle'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // iOS suspends/interrupts the audio context when the page is hidden.
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
  if ((state === 'running' || state === 'paused') && keepAlive.paused) {
    keepAlive.play().catch(() => {});
  }
  if (state === 'running') {
    acquireWakeLock(); // auto-released when the page is hidden
    tick();
  }
});

/* ---------- init ---------- */

loadSettings();
updateTotalPreview();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
