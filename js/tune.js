// ============ TUNING PANEL ============
// Each knob: v = live value, d = default, min/max/step, fmt = display formatting.
// ---- alien fleet knobs (v9.0): second panel, bottom-right ----
export const TUNEA = {
  boxScale: { label: 'box scale',   v: 1.6,   d: 1.6,   min: -3,   max: 3,     step: 0.1,  fmt: x => x.toFixed(1) },
  boxFold:  { label: 'box fold',    v: 0.7,   d: 0.7,   min: 0.3,  max: 1.6,   step: 0.05, fmt: x => x.toFixed(2) },
  boxMinR:  { label: 'box min r',   v: 0.8,   d: 0.8,   min: 0.1,  max: 1.0,   step: 0.05, fmt: x => x.toFixed(2) },
  bulbPow:  { label: 'bulb power',  v: 10,    d: 10,    min: 2,    max: 12,    step: 1,    fmt: x => x.toFixed(0) },
  // Corner fillet on the mothership and harvester hulls, as a fraction of
  // each hull's SMALLEST half-extent -- so it scales with the size sliders
  // instead of needing retuning every time a ship changes shape. 0 is the
  // v9.3 hard-edged box, exactly (see shipDE: r = 0 reduces to sdBox(l, h)).
  boxRound: { label: 'box corners', v: 0.45,  d: 0.45,   min: 0,    max: 1,     step: 0.05, fmt: x => x < 0.025 ? 'sharp' : (100 * x).toFixed(0) + '%' },
  moLen:    { label: 'mother len',  v: 3500,  d: 3500,  min: 400,  max: 5000,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moWid:    { label: 'mother wid',  v: 3500,  d: 3500,  min: 200,  max: 3500,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moHei:    { label: 'mother hgt',  v: 400,   d: 400,   min: 30,   max: 400,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  moAlt:    { label: 'mother alt',  v: 2600,  d: 2600,  min: 1500, max: 15000, step: 100,  fmt: x => x.toFixed(0) + ' m' },
  shLen:    { label: 'ship length', v: 1200,  d: 1200,   min: 80,   max: 1200,  step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shWid:    { label: 'ship width',  v: 800,   d: 800,   min: 20,   max: 800,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shHei:    { label: 'ship height', v: 120,   d: 120,   min: 8,    max: 300,   step: 2,    fmt: x => x.toFixed(0) + ' m' },
  shSpeed:  { label: 'ship speed',  v: 30,    d: 30,    min: 2,    max: 60,    step: 1,    fmt: x => x.toFixed(0) + ' m/s' },
  relSize:  { label: 'relay size',  v: 150,   d: 150,   min: 30,   max: 400,   step: 5,    fmt: x => x.toFixed(0) + ' m' },  // How far the relay swells per delivered energy shot, as a fraction of its
  // BASE radius. This controls SIZE ONLY -- the discharge fires on a fixed
  // RELAY_SHOTS count (50), so the invasion cadence is the same wherever this
  // sits. Over those 50 shots: 1% reaches 1.5x base, 12% reaches the 7x
  // ceiling (which is exactly what v9.3 hard-coded). At 0 the relay never
  // visibly grows but still discharges on schedule.
  relGrow:  { label: 'relay growth',v: 0.01,  d: 0.01,  min: 0,    max: 0.12,  step: 0.005, fmt: x => x < 0.0025 ? 'none' : (100 * x).toFixed(1) + '%' },
};

export const TUNE = {
  shadows:    { label: 'shadows',     v: 1,       d: 1,       min: 0,      max: 1,      step: 1,       fmt: x => x > 0.5 ? 'on' : 'off' },
  // DIAGNOSTIC (v9.4): 0 = the shipped vertical hit tolerance that produced
  // the nadir-centred rings, 1 = measured along the ray. Here so the two can
  // be compared on the SAME frame instead of across two builds. Remove once
  // the call is made.
  // DIAGNOSTIC (v9.4): 0 = ripples with no LOD at all (old), 1 = normal faded
  // and glint broadened as the pixel footprint passes the ripple wavelength.
  cursorA:    { label: 'cursor',      v: 15,      d: 15,      min: 0,      max: 100,    step: 5,       fmt: x => x.toFixed(0) + '%' },
  oceanSlope: { label: 'ocean slope', v: 0.016,   d: 0.016,    min: 0.004,  max: 0.06,   step: 0.001,   fmt: x => x.toFixed(3) },
  oceanMax:   { label: 'ocean depth', v: 107,     d: 107,      min: 20,     max: 140,    step: 1,       fmt: x => x.toFixed(0) },
  massDecay:  { label: 'coast width', v: 0.0011, d: 0.0011, min: 0.001,  max: 0.01,   step: 0.0001,  fmt: x => x.toFixed(4) },
  mountAmp:   { label: 'peak height', v: 460,     d: 460,     min: 100,    max: 800,    step: 10,      fmt: x => x.toFixed(0) },
  snowLine:   { label: 'snow line',   v: 245,     d: 245,     min: 60,     max: 400,    step: 5,       fmt: x => x.toFixed(0) },
  snowyPct:   { label: 'snowy peaks', v: 10,      d: 10,      min: 0,      max: 100,    step: 5,       fmt: x => x.toFixed(0) + '%' },
  fogDens:    { label: 'fog',         v: 0.00012, d: 0.00012, min: 0.00005,max: 0.0009, step: 0.00001, fmt: x => (x*1000).toFixed(2) },
  floraDens:  { label: 'flora density',v: 0.2,    d: 0.2,     min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  treeSize:   { label: 'tree size',   v: 13,      d: 13,      min: 4,      max: 22,     step: 1,       fmt: x => x.toFixed(0) + 'm' },
  // v9.5: the v4.6 "exaggerated perspective" shrank every tree to 35% by 4 km,
  // so a grove's outline changed shape as you flew at it. Off by default now;
  // this restores the old look in one click.
  treePersp:  { label: 'tree persp',  v: 0,       d: 0,       min: 0,      max: 1,      step: 1,       fmt: x => x > 0.5 ? 'shrink far' : 'true size' },
  treeShare:  { label: 'tree share',  v: 0.55,    d: 0.55,     min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  treeTiers:  { label: 'fronds',      v: 11,       d: 11,       min: 3,      max: 14,     step: 1,       fmt: x => x.toFixed(0) },
  treeFract:  { label: 'tree fractal',v: 0.45,     d: 0.45,    min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  floraRange: { label: 'flora range', v: 6000,    d: 6000,    min: 150,    max: 6000,   step: 50,      fmt: x => x.toFixed(0) },
  juliaRe:    { label: 'flora c·re',  v: 0.22,    d: 0.22,    min: -1.0,   max: 0.4,    step: 0.01,    fmt: x => x.toFixed(2) },
  juliaIm:    { label: 'flora c·im',  v: 1.00,    d: 1.00,    min: -1.0,   max: 1.0,    step: 0.01,    fmt: x => x.toFixed(2) },
  bombAngle:  { label: 'bomb angle',  v: 3,       d: 3,       min: -45,    max: 45,     step: 1,       fmt: x => x.toFixed(0) + '°' },
  cloudCount: { label: 'cloud count', v: 11,       d: 11,       min: 0,      max: 16,     step: 1,       fmt: x => x.toFixed(0) },
  cloudSize:  { label: 'cloud size',  v: 250,     d: 250,     min: 60,     max: 280,    step: 5,       fmt: x => x.toFixed(0) + ' m' },
};

// Copy text to the clipboard, with a fallback: navigator.clipboard needs a
// SECURE CONTEXT, which http://localhost is but http://<lan-ip> (phone testing)
// and file:// are not — so the single-file build and the phone both need the
// old hidden-textarea route. Feedback goes on the button itself; tune.js stays
// import-free on purpose (terrain.js imports it, so any import here that
// reaches weapons/terrain would close a dependency cycle).
function copyText(text, btn, label) {
  const done = ok => {
    if (!ok) console.log(text);          // last resort: it is still selectable
    btn.textContent = ok ? 'COPIED ✓' : 'SEE CONSOLE';
    setTimeout(() => { btn.textContent = label; }, 1400);
  };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    done(ok);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), fallback);
  } else fallback();
}

// ---- DEBUG panel (v9.4, diagnostic) ---------------------------------------
// Everything that exists to investigate the viewer-centred artifacts lives
// here rather than in Tuning, because none of it is world tuning.
//
// Three kinds of entry:
//   master - one click snaps everything to the game's normal defaults, another
//            gives back whatever was dialled in. That is the A/B.
//   toggle - a false-colour channel, drawn as a button, summed into uDebugMask.
//   slider - a real render setting that happens to be under investigation.
//
// Reading the channels: they are NOT independent. The march produces t;
// footprint is just t * uPixScale; height / normal / colour all derive from
// those. So "hit distance" and "footprint" are the SAME quantity at different
// band widths, and "terrain height" is world-locked. Concentric rings in those
// views are them working correctly, not evidence of a bug.
export const TUNED = {
  master:     { kind: 'master', label: 'DEBUG', v: 0, d: 0, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'off' },

  resScale:   { kind: 'slider', label: 'resolution',  v: 0, d: 0, min: 0, max: 2, step: 0.05,
                fmt: x => x < 0.025 ? 'auto' : x.toFixed(2) + '\u00d7' },
  detailFade: { kind: 'slider', label: 'detail fade', v: 1, d: 1, min: 0, max: 2, step: 0.05,
                fmt: x => x < 0.025 ? 'off' : x.toFixed(2) },
  rayTol:     { kind: 'slider', label: 'ray tol',     v: 1, d: 1, min: 0, max: 1, step: 0.05,
                fmt: x => x < 0.025 ? 'off (old)' : (x > 0.975 ? 'on' : x.toFixed(2)) },
  waterLOD:   { kind: 'slider', label: 'water LOD',   v: 0.8, d: 0.8, min: 0, max: 1, step: 0.05,
                fmt: x => x < 0.025 ? 'off (old)' : (x > 0.975 ? 'on' : x.toFixed(2)) },
  // v9.5: the two marcher changes that took the beach/ridge flicker to the
  // reference marcher's own parallax count. Both here so they can be flown
  // against the old behaviour on the same frame.
  hitRefine:  { kind: 'slider', label: 'hit refine',  v: 1, d: 1, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'off (old)' },
  // 0.0018 was v9.4, 0.0009 v9.5's beach fix. 0.0002 (13 Sept 2026) is the
  // crest fix: the floor is what shaves the thin clip a ray takes off a sharp
  // ridge, and that miss toggling with the camera was the peaks "breathing".
  // Hard-ray flips 84 -> 14 for +13-22% iterations; 0.0001 buys little more.
  stride:     { kind: 'slider', label: 'march stride', v: 0.0002, d: 0.0002, min: 0.0001, max: 0.0018, step: 0.0001,
                fmt: x => (x * 1000).toFixed(1) + '‰' + (x > 0.00175 ? ' (v9.4)' : x > 0.00085 && x < 0.00095 ? ' (v9.5)' : '') },
  // 13 Sept 2026, Nico: "a version without any alien relays, harvesters or
  // mothership" to tell what moves from what is drawn. Hidden = hulls, beams
  // and their collisions are gone; the invasion economy keeps running under
  // it. Same switch for jul's rings, the one other thing that moves by itself.
  invasion:   { kind: 'slider', label: 'invasion',    v: 1, d: 1, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'hidden' },
  ringsOn:    { kind: 'slider', label: 'rings',       v: 1, d: 1, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'hidden' },

  steps:   { kind: 'toggle', bit: 1,  label: 'march steps',    v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  dist:    { kind: 'toggle', bit: 2,  label: 'hit distance',   v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  foot:    { kind: 'toggle', bit: 4,  label: 'footprint',      v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  height:  { kind: 'toggle', bit: 8,  label: 'terrain height', v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  normal:  { kind: 'toggle', bit: 16, label: 'normal turn',    v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  colLOD:  { kind: 'toggle', bit: 32, label: 'colour LOD',     v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
  budget:  { kind: 'toggle', bit: 64, label: 'march budget',   v: 0, d: 0, min: 0, max: 1, step: 1,
             fmt: x => x > 0.5 ? 'on' : 'off' },
};

// The bitmask the shader reads for the false-colour channels.
export function debugMask() {
  if (TUNED.master.v < 0.5) return 0;
  let m = 0;
  for (const key in TUNED) { const t = TUNED[key]; if (t.bit && t.v > 0.5) m += t.bit; }
  return m;
}

// The Debug panel. Channels are BUTTONS -- one click, no drag, no readout to
// squint at -- because A/B-ing a moving artifact with a slider is unworkable.
// The master remembers what was dialled in, snaps everything to the game's
// defaults, and hands it back on the next click.
function buildDebugPanel(OBJ, panelId, headId, bodyId) {
  const panel = document.getElementById(panelId);
  const body = document.getElementById(bodyId);
  document.getElementById(headId).addEventListener('click', () => {
    panel.classList.toggle('closed');
    panel.querySelector('.caret').textContent = panel.classList.contains('closed') ? '\u25b8' : '\u25be';
  });

  const paints = [];
  // Touching any debug control means the operator is investigating, so the
  // master lights up. OFF then always means exactly 'the game's defaults'.
  let masterPaint = () => {};
  const armMaster = () => {
    const m = OBJ.master;
    if (m && m.v < 0.5) { m.v = 1; masterPaint(); }
  };
  for (const key in OBJ) {
    const t = OBJ[key];
    const row = document.createElement('div');

    if (t.kind === 'slider') {
      row.className = 'trow';
      const label = document.createElement('label');
      label.textContent = t.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = t.min; slider.max = t.max; slider.step = t.step; slider.value = t.v;
      const val = document.createElement('span');
      val.className = 'val'; val.textContent = t.fmt(t.v);
      slider.addEventListener('input', () => {
        t.v = parseFloat(slider.value); val.textContent = t.fmt(t.v);
        armMaster();   // or DEBUG would read 'off' while a setting was live
      });
      slider.addEventListener('keydown', e => e.preventDefault());   // flight keys keep working
      paints.push(() => { slider.value = t.v; val.textContent = t.fmt(t.v); });
      t._slider = slider; t._val = val;
      row.appendChild(label); row.appendChild(slider); row.appendChild(val);
      body.appendChild(row);
      continue;
    }

    row.className = 'drow';
    const btn = document.createElement('button');
    btn.className = 'dbtn' + (t.kind === 'master' ? ' master' : '');
    btn.textContent = t.label;
    const paint = () => btn.classList.toggle('on', t.v > 0.5);

    if (t.kind === 'master') {
      btn.addEventListener('click', () => {
        t.v = t.v > 0.5 ? 0 : 1;
        for (const k2 in OBJ) {
          const o = OBJ[k2];
          if (o.kind === 'master') continue;
          // _user is only set by a previous OFF. On the FIRST activation
          // there is nothing to restore, so leave the value alone --
          // falling back to o.d here wiped whatever had just been dialled in.
          if (t.v > 0.5) { if (o._user !== undefined) o.v = o._user; }
          else { o._user = o.v; o.v = o.d; }
        }
        for (const p of paints) p();
        paint();
        btn.blur();
      });
      masterPaint = paint;
    } else {
      btn.addEventListener('click', () => {
        t.v = t.v > 0.5 ? 0 : 1; paint(); armMaster(); btn.blur();
      });
      paints.push(paint);
    }
    paint();
    row.appendChild(btn);
    body.appendChild(row);
  }

  // Same RESET / COPY JSON pair the other two panels carry, so a debug setup
  // can be handed over verbatim instead of described.
  const btns = document.createElement('div');
  btns.className = 'tbtns';

  const reset = document.createElement('button');
  reset.className = 'treset'; reset.textContent = 'RESET';
  reset.addEventListener('click', () => {
    for (const k in OBJ) { const o = OBJ[k]; o.v = o.d; o._user = undefined; }
    for (const p of paints) p();
    masterPaint();
    reset.blur();
  });
  btns.appendChild(reset);

  const EXPORT_LABEL = 'COPY JSON';
  const exp = document.createElement('button');
  exp.className = 'texport'; exp.textContent = EXPORT_LABEL;
  exp.title = 'copy this panel’s current values to the clipboard as JSON';
  exp.addEventListener('click', () => {
    const values = {};
    for (const k in OBJ) values[k] = OBJ[k].v;
    copyText(JSON.stringify({ panel: panelId, values }, null, 2), exp, EXPORT_LABEL);
    exp.blur();
  });
  btns.appendChild(exp);
  body.appendChild(btns);

  const note = document.createElement('div');
  note.className = 'dnote';
  note.textContent = 'rings in hit distance / footprint are those views working, not a bug';
  body.appendChild(note);
}

function buildPanel(OBJ, panelId, headId, bodyId) {
  const panel = document.getElementById(panelId);
  const body = document.getElementById(bodyId);
  document.getElementById(headId).addEventListener('click', () => {
    panel.classList.toggle('closed');
    panel.querySelector('.caret').textContent = panel.classList.contains('closed') ? '▸' : '▾';
  });
  for (const key in OBJ) {
    const t = OBJ[key];
    const row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML = `<label>${t.label}</label><input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${t.v}"><span class="val">${t.fmt(t.v)}</span>`;
    const slider = row.querySelector('input');
    const val = row.querySelector('.val');
    slider.addEventListener('input', () => { t.v = parseFloat(slider.value); val.textContent = t.fmt(t.v); });
    // keep flight keys working while a slider has focus
    slider.addEventListener('keydown', e => e.preventDefault());
    t._slider = slider; t._val = val;
    body.appendChild(row);
  }
  const btns = document.createElement('div');
  btns.className = 'tbtns';

  const reset = document.createElement('button');
  reset.className = 'treset'; reset.textContent = 'RESET';
  reset.addEventListener('click', () => {
    for (const key in OBJ) { const t = OBJ[key]; t.v = t.d; t._slider.value = t.d; t._val.textContent = t.fmt(t.d); }
    reset.blur();   // or the button keeps focus and SPACE (free flight) re-clicks it
  });
  btns.appendChild(reset);

  // Export the live values as JSON so a tuned world can be handed over verbatim
  // (chat, a commit, jul) instead of read off the sliders by eye.
  const EXPORT_LABEL = 'COPY JSON';
  const exp = document.createElement('button');
  exp.className = 'texport'; exp.textContent = EXPORT_LABEL;
  exp.title = 'copy this panel’s current values to the clipboard as JSON';
  exp.addEventListener('click', () => {
    const values = {};
    for (const key in OBJ) values[key] = OBJ[key].v;
    copyText(JSON.stringify({ panel: panelId, values }, null, 2), exp, EXPORT_LABEL);
    exp.blur();
  });
  btns.appendChild(exp);

  body.appendChild(btns);
}

export function buildTunePanel() {
  buildPanel(TUNE, 'tune', 'tuneHead', 'tuneBody');
  buildPanel(TUNEA, 'tuneA', 'tuneAHead', 'tuneABody');
  buildDebugPanel(TUNED, 'tuneD', 'tuneDHead', 'tuneDBody');
}
