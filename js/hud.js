// HUD readouts, compass needle, crash overlay, toast messages.

import { WATER_LEVEL } from './config.js';
import { craft, flags, camMode } from './state.js';
import { engineCrash, isMuted } from './audio.js';
import { trail } from './fx.js';
import { clearWeapons } from './weapons.js';
import { getScore, resetScore } from './spores.js';
import { resetEnergy } from './energy.js';
import { canvas } from './renderer.js';

const $alt = document.getElementById('alt');
const $spd = document.getElementById('spd');
const $hdg = document.getElementById('hdg');
const $pos = document.getElementById('pos');
const $fps = document.getElementById('fps');
const $res = document.getElementById('res');
const $needle = document.getElementById('cneedle');
const $keyY = document.getElementById('key-y');
const $keyX = document.getElementById('key-x');
const $keyM = document.getElementById('key-m');
const $keyO = document.getElementById('key-o');
export function updateHUD(fps, bw, bh) {
  $alt.textContent = Math.round(craft.pos[1] - WATER_LEVEL);
  $spd.textContent = Math.round(craft.speed);
  let deg = Math.round(Math.atan2(craft.f[0], craft.f[2]) * 180 / Math.PI) % 360;
  if (deg < 0) deg += 360;
  $hdg.textContent = String(deg).padStart(3, '0');
  // v9.5: world x z, so a "the ridge over there glitches" report can carry the
  // spot -- and #pos=x,y,z&hdg=D&obs=1 in the URL puts anyone back on it.
  $pos.textContent = Math.round(craft.pos[0]) + ' ' + Math.round(craft.pos[2]);
  $needle.setAttribute('transform', 'rotate(' + (-deg) + ')');
  $fps.textContent = fps;
  // the resolution slider is only usable if you can see what it costs
  $res.textContent = bw + '×' + bh;
  // toggle-status chips (v8.2): green = active
  $keyY.classList.toggle('on', camMode.free);
  $keyX.classList.toggle('on', camMode.pilot);
  $keyO.classList.toggle('on', camMode.obs);
  $keyM.classList.toggle('on', !isMuted());
}

const $crash = document.getElementById('crash');
const $crashTitle = document.getElementById('crashTitle');
const $crashSub = document.querySelector('#crash .sub');
export function doCrash(kind) {
  flags.crashed = true;
  $crashTitle.textContent = kind;
  $crashSub.textContent = (getScore() > 0 ? getScore() + ' spore points secured — ' : '') + 'press R to fly again';
  $crash.classList.add('show');
  engineCrash();
}
export function unCrash() {
  flags.crashed = false;
  $crash.classList.remove('show');
  trail.length = 0;
  clearWeapons();
  resetScore();
  resetEnergy();   // R returns the pool to START, not to whatever was left
}

// cursor visibility (v8.0): 100 = native crosshair, 0 = hidden; in between a
// custom crosshair drawn at that alpha (a native cursor cannot be translucent).
// Lives here rather than in main.js because js/laser.js has to RESTORE it: the
// charge reticle overwrites canvas.style.cursor, and clearing that would drop
// the player's own TUNE.cursorA setting instead of putting it back.
export function applyCursor(v) {
  if (v <= 0) { canvas.style.cursor = 'none'; return; }
  if (v >= 100) { canvas.style.cursor = 'crosshair'; return; }
  const cc = document.createElement('canvas');
  cc.width = 25; cc.height = 25;
  const g = cc.getContext('2d');
  g.globalAlpha = v / 100;
  g.strokeStyle = '#000'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(12.5, 1); g.lineTo(12.5, 24); g.moveTo(1, 12.5); g.lineTo(24, 12.5); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(12.5, 2); g.lineTo(12.5, 23); g.moveTo(2, 12.5); g.lineTo(23, 12.5); g.stroke();
  canvas.style.cursor = 'url(' + cc.toDataURL() + ') 12 12, crosshair';
}

// toast: transient messages (gyro permission hints etc.)
const $toast = document.getElementById('toast');
let toastTimer = 0;
export function toast(msg, ms) {
  $toast.textContent = msg;
  $toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.style.display = 'none'; }, ms || 4000);
}
export function hideToast() { $toast.style.display = 'none'; }

// ---- fleet counters (v9.4) -------------------------------------------------
// Live hull counts beside RINGS and SPORES. Counts what is ALIVE, not what
// exists: a falling or melting wreck is already dead (hullAlive is false for
// it) and lingers for ~116 s, so counting objects would leave the tally stuck
// above zero long after the last kill and the defeated banner would never fire.
const $harv = document.getElementById('harvCount');
const $ringsScore = document.getElementById('hud-score');
let lastFleet = '';

export function setFleetCounts(harv, relays, mothers) {
  const key = harv + '/' + relays + '/' + mothers;
  if (key === lastFleet) return;        // DOM writes only when a number moves
  lastFleet = key;
  $harv.textContent = harv;
  // Gated on the WHOLE invasion, not just the harvesters: bomb every harvester
  // while the mothership still floats overhead and it will simply build more,
  // so declaring victory then would be wrong. Only the harvester count is
  // shown -- they are what you actually hunt.
  $ringsScore.classList.toggle('defeated', harv === 0 && relays === 0 && mothers === 0);
}

export function resetFleetCounts() {
  lastFleet = '';
  $ringsScore.classList.remove('defeated');
}
