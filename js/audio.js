// All synthesized audio: engine (saws + noise + banking wobble LFO), ground
// grind rumble, in-cloud wind, spore pop, ring chime, gun/bomb/explosion,
// crash. Starts on first input (browser autoplay policy). M toggles mute.

import { craft, flags } from './state.js';

let AC = null, ENG = null, muted = false;

export function toggleMute() { muted = !muted; }
export function isMuted() { return muted; }
export function ensureAudio() {
  if (AC || muted) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const o1 = AC.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.8; // beat detune
    const nb = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const ch = nb.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
    const ng = AC.createGain(); ng.gain.value = 0.25;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = AC.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); ns.connect(nf); nf.connect(ng); ng.connect(lp);
    lp.connect(g); g.connect(AC.destination);
    // banking wobble: an LFO amplitude-modulates the engine and flutters the
    // lowpass while banked — the engine strains through the turn
    const lfo = AC.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 9;
    const lfoG = AC.createGain(); lfoG.gain.value = 0;
    const lfoF = AC.createGain(); lfoF.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    lfo.connect(lfoF); lfoF.connect(lp.frequency);
    // ground-grind rumble: the same noise buffer slowed way down through a
    // deep lowpass — gain stays 0 until the belly touches terrain
    const gs = AC.createBufferSource(); gs.buffer = nb; gs.loop = true;
    gs.playbackRate.value = 0.32;
    const gf = AC.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 140;
    const gg = AC.createGain(); gg.gain.value = 0;
    gs.connect(gf); gf.connect(gg); gg.connect(AC.destination);
    // in-cloud wind: mid-speed noise through a wandering lowpass, gain 0 in clear air
    const cs2 = AC.createBufferSource(); cs2.buffer = nb; cs2.loop = true;
    cs2.playbackRate.value = 0.55;
    const wf = AC.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
    const wg = AC.createGain(); wg.gain.value = 0;
    cs2.connect(wf); wf.connect(wg); wg.connect(AC.destination);
    o1.start(); o2.start(); ns.start(); lfo.start(); gs.start(); cs2.start();
    ENG = { o1, o2, lp, g, lfo, lfoG, lfoF, grindF: gf, grindG: gg, windF: wf, windG: wg };
  } catch (e) { /* audio unavailable — fly silent */ }
}
export function engineUpdate(speed, boost, pitchBend, turn) {
  if (!ENG) return;
  const T = AC.currentTime;
  const gain = (muted || flags.crashed) ? 0 : 0.055 + speed * 0.00022 + (boost ? 0.05 : 0);
  ENG.g.gain.setTargetAtTime(gain, T, 0.12);
  // dive/climb pitch bend: W drives it down, S up, in octaves (2^bend)
  const mul = Math.pow(2, pitchBend);
  const f = (42 + speed * 0.13) * mul;
  ENG.o1.frequency.setTargetAtTime(f, T, 0.1);
  ENG.o2.frequency.setTargetAtTime(f * 1.014, T, 0.1);
  ENG.lp.frequency.setTargetAtTime((360 + speed * 2.6 + (boost ? 500 : 0)) * Math.sqrt(mul), T, 0.2);
  // banking wobble: depth and rate track the actual bank angle
  const wob = (muted || flags.crashed) ? 0 : turn;
  ENG.lfoG.gain.setTargetAtTime(wob * gain * 0.75, T, 0.08);
  ENG.lfoF.gain.setTargetAtTime(wob * 200, T, 0.08);
  ENG.lfo.frequency.setTargetAtTime(8 + wob * 5, T, 0.12);
}
export function grindUpdate(amt) {
  // amt 0..1 = how deep into the scrape band the belly sits
  if (!ENG) return;
  const T = AC.currentTime;
  const g = (muted || flags.crashed) ? 0 : amt * 0.45;
  ENG.grindG.gain.setTargetAtTime(g, T, 0.05);
  ENG.grindF.frequency.setTargetAtTime(110 + amt * 240 + craft.speed * 1.4, T, 0.1);
}
export function popSound(delay, gain) {
  if (!AC || muted) return;
  const T = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(520 + Math.random() * 180, T);
  o.frequency.exponentialRampToValueAtTime(150, T + 0.11);
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(gain || 0.20, T + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.16);
  o.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 0.18);
}
export function engineCrash() {
  if (!AC) return;
  const T = AC.currentTime;
  if (ENG) { ENG.g.gain.setTargetAtTime(0, T, 0.03); ENG.grindG.gain.setTargetAtTime(0, T, 0.03); }
  if (muted) return;
  // 8-bit "Crrrrsssshhh": 5-level sample-and-hold noise, pitched down as it decays
  const dur = 0.9, sr = AC.sampleRate;
  const buf = AC.createBuffer(1, Math.floor(sr * dur), sr);
  const ch = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < ch.length; i++) {
    if (i % 96 === 0) v = (Math.floor(Math.random() * 5) - 2) / 2;
    ch[i] = v;
  }
  const src = AC.createBufferSource(); src.buffer = buf;
  src.playbackRate.setValueAtTime(1.25, T);
  src.playbackRate.exponentialRampToValueAtTime(0.3, T + dur);
  const clp = AC.createBiquadFilter(); clp.type = 'lowpass';
  clp.frequency.setValueAtTime(3200, T);
  clp.frequency.exponentialRampToValueAtTime(160, T + dur);
  const cg = AC.createGain();
  cg.gain.setValueAtTime(0.38, T);
  cg.gain.exponentialRampToValueAtTime(0.001, T + dur);
  src.connect(clp); clp.connect(cg); cg.connect(AC.destination);
  src.start(T); src.stop(T + dur);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(90, T); o.frequency.exponentialRampToValueAtTime(28, T + 0.35);
  g.gain.setValueAtTime(0.5, T); g.gain.exponentialRampToValueAtTime(0.001, T + 0.5);
  o.connect(g); g.connect(AC.destination); o.start(T); o.stop(T + 0.55);
}

export function cloudWindUpdate(amt) {
  // in-cloud wind/rumble: swells with immersion depth, wanders a little
  if (!ENG) return;
  const T = AC.currentTime;
  const g = (muted || flags.crashed) ? 0 : amt * 0.20;
  ENG.windG.gain.setTargetAtTime(g, T, 0.12);
  ENG.windF.frequency.setTargetAtTime(320 + amt * 320 + Math.sin(T * 1.7) * 80 * amt, T, 0.15);
}

export function fireSound() {
  // soft laser pew: quick triangle sweep, deliberately quiet
  if (!AC || muted) return;
  const T = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1350 + Math.random() * 120, T);
  o.frequency.exponentialRampToValueAtTime(230, T + 0.12);
  f.type = 'lowpass'; f.frequency.value = 2400;
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(0.085, T + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.15);
  o.connect(f); f.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 0.17);
}

export function bombDropSound() {
  if (!AC || muted) return;
  const T = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(230, T);
  o.frequency.exponentialRampToValueAtTime(130, T + 0.09);
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(0.055, T + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.11);
  o.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 0.13);
}

// Bomb against an alien hull.
//
// The first attempt at this just took explosionSound() and moved every
// frequency down. That was a mistake: it is the same ARCHITECTURE -- a noise
// burst under a sweeping lowpass, plus a sine drop -- so it still read as "the
// ground blast, further away" rather than as a different event.
//
// What separates hitting a hull from hitting dirt is RESONANCE. Soil is
// broadband and dead; a big hollow metal box rings at a few frequencies and
// sustains. So this is built the other way round: two narrow bandpass bands
// with high Q ring on after the impact, over a deep sub, and the bright crack
// that makes explosionSound() read as "open air" is gone entirely.
export function hullExplosionSound() {
  if (!AC || muted) return;
  const T = AC.currentTime, sr = AC.sampleRate;
  const noise = (dur) => {
    const buf = AC.createBuffer(1, Math.floor(sr * dur), sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = buf;
    return src;
  };

  // sub: the "bassy" part -- an octave under the ground blast's 64 Hz
  const o = AC.createOscillator(), og = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(44, T);
  o.frequency.exponentialRampToValueAtTime(16, T + 1.0);
  og.gain.setValueAtTime(0.7, T);
  og.gain.exponentialRampToValueAtTime(0.001, T + 1.25);
  o.connect(og); og.connect(AC.destination);
  o.start(T); o.stop(T + 1.3);

  // whump: resonant lowpass, Q high enough to have a body of its own
  const wsrc = noise(0.6);
  const wf = AC.createBiquadFilter(); wf.type = 'lowpass'; wf.Q.value = 9;
  wf.frequency.setValueAtTime(240, T);
  wf.frequency.exponentialRampToValueAtTime(55, T + 0.5);
  const wg = AC.createGain();
  wg.gain.setValueAtTime(0.45, T);
  wg.gain.exponentialRampToValueAtTime(0.001, T + 0.55);
  wsrc.connect(wf); wf.connect(wg); wg.connect(AC.destination);
  wsrc.start(T); wsrc.stop(T + 0.6);

  // hull ring: the part that says "metal box". Two narrow bands, different
  // decays, so the tail beats slightly instead of sounding like one tone.
  for (const [hz, q, gain, dur] of [[118, 16, 0.30, 1.0], [287, 13, 0.17, 0.72]]) {
    const rs = noise(dur);
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = hz; bp.Q.value = q;
    const rg = AC.createGain();
    rg.gain.setValueAtTime(gain, T);
    rg.gain.exponentialRampToValueAtTime(0.001, T + dur);
    rs.connect(bp); bp.connect(rg); rg.connect(AC.destination);
    rs.start(T); rs.stop(T + dur + 0.02);
  }

  // onset: a short mid thud so the hit has an edge, well below the ground
  // blast's 1500 Hz highpass crack
  const tsrc = noise(0.09);
  const tf = AC.createBiquadFilter(); tf.type = 'bandpass';
  tf.frequency.value = 700; tf.Q.value = 1.1;
  const tg = AC.createGain();
  tg.gain.setValueAtTime(0.14, T);
  tg.gain.exponentialRampToValueAtTime(0.001, T + 0.09);
  tsrc.connect(tf); tf.connect(tg); tg.connect(AC.destination);
  tsrc.start(T); tsrc.stop(T + 0.1);
}

export function explosionSound() {
  if (!AC || muted) return;
  const T = AC.currentTime;
  // body: filtered noise sweeping down
  const dur = 0.85, sr = AC.sampleRate;
  const buf = AC.createBuffer(1, Math.floor(sr * dur), sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(2200, T);
  f.frequency.exponentialRampToValueAtTime(90, T + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.42, T);
  g.gain.exponentialRampToValueAtTime(0.001, T + dur);
  src.connect(f); f.connect(g); g.connect(AC.destination);
  src.start(T); src.stop(T + dur);
  // crack: a few ms of bright noise right at detonation
  const csrc = AC.createBufferSource(); csrc.buffer = buf;
  const cf = AC.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 1500;
  const cg = AC.createGain();
  cg.gain.setValueAtTime(0.28, T);
  cg.gain.exponentialRampToValueAtTime(0.001, T + 0.07);
  csrc.connect(cf); cf.connect(cg); cg.connect(AC.destination);
  csrc.start(T); csrc.stop(T + 0.08);
  // thump: deep sine drop
  const o = AC.createOscillator(), og = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(64, T);
  o.frequency.exponentialRampToValueAtTime(24, T + 0.5);
  og.gain.setValueAtTime(0.45, T);
  og.gain.exponentialRampToValueAtTime(0.001, T + 0.55);
  o.connect(og); og.connect(AC.destination);
  o.start(T); o.stop(T + 0.6);
  // white-noise tail: a soft unfiltered wash lingering after the boom
  const tdur = 2.0;
  const tbuf = AC.createBuffer(1, Math.floor(sr * tdur), sr);
  const tch = tbuf.getChannelData(0);
  for (let i = 0; i < tch.length; i++) tch[i] = Math.random() * 2 - 1;
  const tsrc = AC.createBufferSource(); tsrc.buffer = tbuf;
  const tg = AC.createGain();
  tg.gain.setValueAtTime(0.0001, T);
  tg.gain.exponentialRampToValueAtTime(0.055, T + 0.18);   // swells in as the boom fades
  tg.gain.exponentialRampToValueAtTime(0.001, T + tdur);
  tsrc.connect(tg); tg.connect(AC.destination);
  tsrc.start(T); tsrc.stop(T + tdur);
}

export function zapSound() {
  // harvester -> relay energy shot: quick filtered square zap
  if (!AC || muted) return;
  const T = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'square';
  o.frequency.setValueAtTime(920, T);
  o.frequency.exponentialRampToValueAtTime(180, T + 0.16);
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2.5;
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(0.09, T + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.2);
  o.connect(f); f.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 0.22);
}

// ---- player laser (v9.9) --------------------------------------------------
// The charge hum is a SUSTAINED voice, not a one-shot, because it has to last
// exactly as long as the button is held — so it is started and stopped by the
// caller and kept in a module-level handle. Two detuned saws through a rising
// lowpass: the pitch and the brightness both climb over the 2 s charge, so the
// sound tells you when the shot is ready without looking at the cursor.
let CHARGE = null;
// `armable` false = there is not enough energy for a shot. The spin-up is the
// same either way -- you always hear the weapon TRY -- but a dud rises and
// then falls back to silence instead of settling into the sustained hum, so
// the ear learns the difference before the reticle ever appears. The electric
// hum is reserved for a charge that will actually fire.
export function laserChargeStart(seconds, armable) {
  if (!AC || muted || CHARGE) return;
  const T = AC.currentTime;
  const o1 = AC.createOscillator(), o2 = AC.createOscillator();
  const f = AC.createBiquadFilter(), g = AC.createGain();
  o1.type = 'sawtooth'; o2.type = 'sawtooth';
  f.type = 'lowpass'; f.Q.value = 6;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(AC.destination);
  if (armable) {
    o1.frequency.setValueAtTime(70, T);   o1.frequency.linearRampToValueAtTime(190, T + seconds);
    o2.frequency.setValueAtTime(70.9, T); o2.frequency.linearRampToValueAtTime(193, T + seconds);  // beat detune
    f.frequency.setValueAtTime(220, T);   f.frequency.linearRampToValueAtTime(2400, T + seconds);
    g.gain.setValueAtTime(0.0001, T);
    g.gain.exponentialRampToValueAtTime(0.055, T + 0.25);
  } else {
    // Dud: climbs, HOLDS near its peak, then sags away. The first version
    // peaked at 0.55 of the charge and was gone by the end of it, which read
    // as a blip rather than as a weapon failing to spin up. It now peaks at
    // 0.5, sustains to 1.15 and only dies at 1.9x the charge window, so it
    // outlasts the press and is clearly audible.
    const peak = T + seconds * 0.50;
    const hold = T + seconds * 1.15;
    const end  = T + seconds * 1.90;
    o1.frequency.setValueAtTime(70, T);   o1.frequency.linearRampToValueAtTime(138, peak);
    o1.frequency.setValueAtTime(138, hold); o1.frequency.linearRampToValueAtTime(46, end);
    o2.frequency.setValueAtTime(70.9, T); o2.frequency.linearRampToValueAtTime(140, peak);
    o2.frequency.setValueAtTime(140, hold); o2.frequency.linearRampToValueAtTime(47, end);
    f.frequency.setValueAtTime(220, T);   f.frequency.linearRampToValueAtTime(1100, peak);
    f.frequency.setValueAtTime(1100, hold); f.frequency.linearRampToValueAtTime(150, end);
    g.gain.setValueAtTime(0.0001, T);
    g.gain.exponentialRampToValueAtTime(0.050, peak);
    g.gain.setValueAtTime(0.050, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  o1.start(T); o2.start(T);
  CHARGE = { o1, o2, g };
}
export function laserChargeStop() {
  if (!CHARGE) return;
  const { o1, o2, g } = CHARGE;
  CHARGE = null;
  if (!AC) return;
  const T = AC.currentTime;
  // ramp out rather than stop dead: cutting a sustained voice at full gain is
  // a click, and this one can be cut on every bomb-length right-click
  try {
    g.gain.cancelScheduledValues(T);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), T);
    g.gain.exponentialRampToValueAtTime(0.0001, T + 0.06);
    o1.stop(T + 0.08); o2.stop(T + 0.08);
  } catch (_) {}
}

export function laserFireSound() {
  // the discharge: a bright downward sweep with a noise transient on the front
  if (!AC || muted) return;
  const T = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(2600, T);
  o.frequency.exponentialRampToValueAtTime(240, T + 0.45);
  f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.4;
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(0.16, T + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.5);
  o.connect(f); f.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 0.52);
}

export function laserCrackSound() {
  // hull strike: electrical crackle — filtered noise chopped by a fast LFO on
  // the gain, which reads as arcing rather than as an explosion
  if (!AC || muted) return;
  const T = AC.currentTime;
  const nb = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.5), AC.sampleRate);
  const ch = nb.getChannelData(0);
  for (let i = 0; i < ch.length; i++) {
    const k = i / ch.length;
    ch[i] = (Math.random() * 2 - 1) * (Math.random() < 0.35 + 0.4 * (1 - k) ? 1 : 0.15);
  }
  const ns = AC.createBufferSource(); ns.buffer = nb;
  const f = AC.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(3200, T);
  f.frequency.exponentialRampToValueAtTime(700, T + 0.4);
  f.Q.value = 3;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.22, T);
  g.gain.exponentialRampToValueAtTime(0.0001, T + 0.45);
  ns.connect(f); f.connect(g); g.connect(AC.destination);
  ns.start(T); ns.stop(T + 0.5);
}

export function relayBlastSound() {
  // Relay -> mothership discharge: a rising-falling saw sweep, stretched to
  // cover the 2 s deflation in aliens.js (RELAY_SHRINK_MS). It used to finish
  // in 1.25 s while the relay snapped back instantly; now the sound, the beam
  // and the collapse all run for the same two seconds.
  if (!AC || muted) return;
  const T = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, T);
  o.frequency.exponentialRampToValueAtTime(950, T + 0.85);
  o.frequency.exponentialRampToValueAtTime(110, T + 1.95);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2400, T);
  f.frequency.exponentialRampToValueAtTime(700, T + 2.0);   // closes as it sags
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(0.30, T + 0.10);
  g.gain.exponentialRampToValueAtTime(0.22, T + 1.2);       // holds through the collapse
  g.gain.exponentialRampToValueAtTime(0.0001, T + 2.05);
  o.connect(f); f.connect(g); g.connect(AC.destination);
  o.start(T); o.stop(T + 2.1);
}


export function ringSound() {
  // bright two-note chime, distinct from the spore pop
  if (!AC || muted) return;
  const T = AC.currentTime;
  for (let i = 0; i < 2; i++) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(i === 0 ? 880 : 1320, T + i * 0.07);
    g.gain.setValueAtTime(0.0001, T + i * 0.07);
    g.gain.exponentialRampToValueAtTime(0.22, T + i * 0.07 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, T + i * 0.07 + 0.28);
    o.connect(g); g.connect(AC.destination);
    o.start(T + i * 0.07); o.stop(T + i * 0.07 + 0.3);
  }
}
