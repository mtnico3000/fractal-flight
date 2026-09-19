// All input sources: keyboard, mouse (fire / bomb / sun drag), virtual
// joystick, touch buttons, and gyroscope tilt. Each source writes into its
// own state object; the flight model sums and clamps them.

import { sun, viewZoom, camMode } from './state.js';
import { SUN_EL_MIN, SUN_EL_MAX } from './config.js';
import { canvas } from './renderer.js';
import { ensureAudio, toggleMute, laserChargeStart } from './audio.js';
import { fireGun, dropBomb } from './weapons.js';
import { laserPress, laserRelease, laserCancel, LASER_CHARGE_MS } from './laser.js';
import { toast, hideToast } from './hud.js';

export const keys = Object.create(null);
export const touchInput = { steer: 0, pitch: 0, lift: 0, boost: false };
export const gyroInput = { steer: 0, pitch: 0 };
export const mouse = { lmbDown: false, lastAuto: 0 };   // hold-to-burst state, read by flight.js
export const mouseView = { x: window.innerWidth / 2, y: window.innerHeight / 2 };   // orbit-view cursor
export const viewOrigin = { x: window.innerWidth / 2, y: window.innerHeight / 2 };   // orbit center (middle-click moves it)

export const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');

export function initInput(onReset) {
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  ensureAudio();
  if (e.code === 'KeyM') toggleMute();
  if ((e.code === 'KeyY' || e.code === 'KeyZ') && !e.repeat) camMode.free = !camMode.free;   // KeyZ too: QWERTZ keyboards report the Y keycap as KeyZ
  if (e.code === 'KeyX' && !e.repeat) camMode.pilot = !camMode.pilot;
  if (e.code === 'KeyO' && !e.repeat) camMode.obs = !camMode.obs;
  if (e.code === 'KeyR') onReset();
  if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
});
canvas.addEventListener('pointerdown', ensureAudio);
window.addEventListener('keyup', e => { keys[e.code] = false; });

// LEFT button: fire (hold = burst).
// MIDDLE button: quick click recenters the view; press-and-move repositions
//   the sun. The sun moved here in v9.9 to free the right button for the
//   laser, and it keeps the same click-vs-drag split the right button used:
//   short press = the old action, movement = the drag.
// RIGHT button: quick click drops a bomb; holding past LASER_CHARGE_MS arms
//   the laser and releasing fires it.
let mbDown = false, mbStartT = 0, mbStartX = 0, mbStartY = 0, sunDragging = false;
let lastMX = 0, lastMY = 0;
let rbDown = false;
// mouse-orbit view tracking (v7.5) — frozen while dragging the sun, but NOT
// while the laser is charging: the cursor is the aim point, so it has to keep
// tracking through the whole right-button hold.
window.addEventListener('mousemove', e => {
  if (sunDragging) return;
  mouseView.x = e.clientX; mouseView.y = e.clientY;
});
// wheel zoom (v7.5): down = farther (up to map scale), up = closer, past the
// plane = cockpit view
window.addEventListener('wheel', e => {
  e.preventDefault();
  if (!camMode.free) return;   // wheel zoom only while the Y camera mode is on
  viewZoom.t = Math.max(0.07, Math.min(400, viewZoom.t * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (IS_TOUCH) return;   // touch uses the on-screen buttons + sun drag below
  if (e.button === 1) {
    e.preventDefault();   // suppress the middle-click autoscroll widget
    mbDown = true; sunDragging = false;
    mbStartT = performance.now();
    mbStartX = lastMX = e.clientX; mbStartY = lastMY = e.clientY;
    return;
  }
  if (e.button === 0) {
    fireGun();
    mouse.lmbDown = true; mouse.lastAuto = performance.now();
  } else if (e.button === 2) {
    rbDown = true;
    // the press answers whether there is energy for a shot, and the charge
    // sound commits to that answer: a rising hum, or a dud that sags to silence
    const armable = laserPress(performance.now());
    laserChargeStart(LASER_CHARGE_MS / 1000, armable);
  }
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouse.lmbDown = false;
  if (e.button === 1 && mbDown) {
    // a middle press that never became a drag still recenters the view, and
    // zoom resets too — but ONLY from beyond the default, so zoomed-in and
    // cockpit views keep their zoom and are just re-aimed (v7.5)
    if (!sunDragging && performance.now() - mbStartT < 400) {
      viewOrigin.x = e.clientX; viewOrigin.y = e.clientY;
      if (viewZoom.t > 1) viewZoom.t = 1;
    }
    mbDown = false; sunDragging = false;
  }
  if (e.button === 2 && rbDown) {
    rbDown = false;
    // a charged release fires; anything shorter is still a bomb, so the
    // right button keeps the behaviour it has had since v3
    if (!laserRelease(performance.now(), e.clientX, e.clientY)) dropBomb();
  }
});
window.addEventListener('mousemove', e => {
  if (!mbDown) return;
  if (!sunDragging) {
    const moved = Math.abs(e.clientX - mbStartX) + Math.abs(e.clientY - mbStartY);
    if (moved > 6 || performance.now() - mbStartT > 400) sunDragging = true;
  }
  if (sunDragging) {
    sun.az += (e.clientX - lastMX) * 0.005;
    sun.el = Math.min(SUN_EL_MAX, Math.max(SUN_EL_MIN, sun.el - (e.clientY - lastMY) * 0.004));
  }
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  mouse.lmbDown = false; rbDown = false; mbDown = false; sunDragging = false;
  laserCancel();   // a charge held across a focus loss must not survive it
});

// ---- touch + gyro ----
// Each input source writes its own state object; update() sums and clamps,
// so keyboard, joystick and tilt can be combined freely.


// setPointerCapture throws on synthetic events and must never block input
function capture(el, id) { try { el.setPointerCapture(id); } catch (_) {} }

if (IS_TOUCH) (function initTouch() {
  // ---- sun drag on the canvas (pointer events) ----
  let dragId = null, tLastX = 0, tLastY = 0;
  canvas.addEventListener('pointerdown', e => {
    if (dragId !== null) return;
    e.preventDefault();          // also suppresses the synthetic mousedown
    ensureAudio();
    dragId = e.pointerId; tLastX = e.clientX; tLastY = e.clientY;
    capture(canvas, e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== dragId) return;
    sun.az += (e.clientX - tLastX) * 0.005;
    sun.el = Math.min(SUN_EL_MAX, Math.max(SUN_EL_MIN, sun.el - (e.clientY - tLastY) * 0.004));
    tLastX = e.clientX; tLastY = e.clientY;
  });
  const endSunDrag = e => { if (e.pointerId === dragId) dragId = null; };
  canvas.addEventListener('pointerup', endSunDrag);
  canvas.addEventListener('pointercancel', endSunDrag);

  // ---- virtual joystick ----
  const joyEl = document.getElementById('joystick');
  const stickEl = document.getElementById('stick');
  let joyId = null;

  function moveStick(e) {
    const rect = joyEl.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const max = rect.width * 0.35;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    stickEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    touchInput.steer = -dx / max;  // stick right = bank right (matches D)
    touchInput.pitch = dy / max;   // stick up = nose down (matches W)
  }
  joyEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureAudio();
    joyId = e.pointerId;
    moveStick(e);
    capture(joyEl, e.pointerId);
  });
  joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) moveStick(e); });
  const endJoy = e => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    touchInput.steer = 0; touchInput.pitch = 0;
    stickEl.style.transform = 'translate(0px,0px)';
  };
  joyEl.addEventListener('pointerup', endJoy);
  joyEl.addEventListener('pointercancel', endJoy);

  // ---- hold buttons ----
  function holdButton(id, on, off) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      ensureAudio();
      el.classList.add('on');
      on();
      capture(el, e.pointerId);
    });
    const end = () => { el.classList.remove('on'); off(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  holdButton('btn-boost', () => { touchInput.boost = true; }, () => { touchInput.boost = false; });
  holdButton('btn-up',    () => { touchInput.lift = 1; },     () => { touchInput.lift = 0; });
  holdButton('btn-down',  () => { touchInput.lift = -1; },    () => { touchInput.lift = 0; });
  // FIRE reuses the desktop hold-to-burst path; BOMB is a tap
  holdButton('btn-fire',  () => { fireGun(); lmbDown = true; lastAuto = performance.now(); },
                          () => { lmbDown = false; });
  document.getElementById('btn-bomb').addEventListener('pointerdown', e => {
    e.preventDefault(); ensureAudio(); dropBomb();
  });
  document.getElementById('btn-reset').addEventListener('pointerdown', e => {
    e.preventDefault(); onReset();
  });

  // Block iOS Safari scroll / pull-to-refresh / double-tap zoom
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
})();

// ---- gyroscope tilt (works alongside the joystick) ----
(function initGyro() {
  const tiltBtn = document.getElementById('btn-tilt');
  if (!tiltBtn) return;
  const gyro = { on: false, needCal: false, calSteer: 0, calPitch: 0, lastData: -1, source: null, checkTimer: 0 };

  function orientAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return window.orientation || 0;
  }

  // Remap beta/gamma to steer/pitch for the current screen rotation
  function tiltAxes(e) {
    const a = ((orientAngle() % 360) + 360) % 360;
    const beta = e.beta || 0, gamma = e.gamma || 0;
    if (a === 90)  return { steer: beta,  pitch: -gamma };
    if (a === 270) return { steer: -beta, pitch: gamma };
    if (a === 180) return { steer: -gamma, pitch: -beta };
    return { steer: gamma, pitch: beta };
  }

  function onTilt(e) {
    if (e.beta === null && e.gamma === null) return; // sensor blocked/empty
    if (e.type === 'deviceorientationabsolute') {
      if (gyro.source === 'deviceorientation') return;
    } else {
      gyro.source = 'deviceorientation';
    }
    gyro.lastData = performance.now();
    if (!gyro.on) return;
    if (tiltBtn.classList.contains('err')) {
      tiltBtn.classList.remove('err');
      hideToast();
    }
    const ax = tiltAxes(e);
    if (gyro.needCal) { gyro.calSteer = ax.steer; gyro.calPitch = ax.pitch; gyro.needCal = false; }
    const DEAD = 2.5, RANGE = 22; // degrees: deadzone, then full input at DEAD+RANGE
    const shape = d => {
      const m = Math.abs(d) < DEAD ? 0 : (Math.abs(d) - DEAD) / RANGE;
      return Math.sign(d) * Math.min(1, m);
    };
    gyroInput.steer = -shape(ax.steer - gyro.calSteer); // tilt right = bank right
    gyroInput.pitch = shape(ax.pitch - gyro.calPitch);  // tilt forward = nose down
  }
  window.addEventListener('deviceorientation', onTilt);
  window.addEventListener('deviceorientationabsolute', onTilt);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', () => { if (gyro.on) gyro.needCal = true; });
  }

  function setTilt(on) {
    gyro.on = on;
    gyro.needCal = on; // current pose becomes neutral on enable
    gyroInput.steer = 0; gyroInput.pitch = 0;
    tiltBtn.classList.toggle('on', on);
    tiltBtn.classList.remove('err');
    clearTimeout(gyro.checkTimer);
    if (on) {
      const enabledAt = performance.now();
      gyro.checkTimer = setTimeout(() => {
        if (gyro.on && gyro.lastData < enabledAt) {
          tiltBtn.classList.add('err');
          toast('NO MOTION SENSOR DATA — allow "Motion sensors" in your browser\u2019s site settings (Vanadium blocks them by default), then tap TILT again', 8000);
        }
      }, 1500);
    } else {
      hideToast();
    }
  }
  tiltBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (gyro.on) { setTilt(false); return; }
    // iOS 13+ requires an explicit permission request from a user gesture
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => setTilt(state === 'granted'))
        .catch(() => setTilt(false));
    } else {
      setTilt(true);
    }
  });
})();
}
