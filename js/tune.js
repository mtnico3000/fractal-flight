// ============ TUNING PANEL ============
// Each knob: v = live value, d = default, min/max/step, fmt = display formatting.
// ---- alien fleet knobs (v9.0): second panel, bottom-right ----
export const TUNEA = {
  boxScale: { label: 'box scale',   v: 3,   d: 3,   min: -4,   max: 4,     step: 0.1,  fmt: x => x.toFixed(1) },
  boxFold:  { label: 'box fold',    v: 1.4,   d: 1.4,   min: 0.2,  max: 3,   step: 0.05, fmt: x => x.toFixed(2) },
  boxMinR:  { label: 'box min r',   v: 0.1,   d: 0.1,   min: 0.05,  max: 1.5,   step: 0.05, fmt: x => x.toFixed(2) },
  bulbPow:  { label: 'bulb power',  v: 12,    d: 12,    min: 2,    max: 16,    step: 1,    fmt: x => x.toFixed(0) },
  // Corner fillet on the mothership and harvester hulls, as a fraction of
  // each hull's SMALLEST half-extent -- so it scales with the size sliders
  // instead of needing retuning every time a ship changes shape. 0 is the
  // v9.3 hard-edged box, exactly (see shipDE: r = 0 reduces to sdBox(l, h)).
  boxRound: { label: 'box corners', v: 0.45,  d: 0.45,   min: 0,    max: 1,     step: 0.05, fmt: x => x < 0.025 ? 'sharp' : (100 * x).toFixed(0) + '%' },
  moLen:    { label: 'mother len',  v: 3500,  d: 3500,  min: 400,  max: 5000,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moWid:    { label: 'mother wid',  v: 3500,  d: 3500,  min: 200,  max: 3500,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moHei:    { label: 'mother hgt',  v: 400,   d: 400,   min: 30,   max: 400,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  moAlt:    { label: 'mother alt',  v: 2400,  d: 2400,  min: 1500, max: 15000, step: 100,  fmt: x => x.toFixed(0) + ' m' },
  shLen:    { label: 'ship length', v: 1200,  d: 1200,   min: 80,   max: 1200,  step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shWid:    { label: 'ship width',  v: 650,   d: 650,   min: 20,   max: 800,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shHei:    { label: 'ship height', v: 206,   d: 206,   min: 8,    max: 300,   step: 2,    fmt: x => x.toFixed(0) + ' m' },
  shSpeed:  { label: 'ship speed',  v: 46,    d: 46,    min: 2,    max: 60,    step: 1,    fmt: x => x.toFixed(0) + ' m/s' },
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
  oceanSlope: { label: 'ocean slope', v: 0.029,   d: 0.029,    min: 0.004,  max: 0.06,   step: 0.001,   fmt: x => x.toFixed(3) },
  oceanMax:   { label: 'ocean depth', v: 59,      d: 59,       min: 20,     max: 140,    step: 1,       fmt: x => x.toFixed(0) },
  massDecay:  { label: 'coast width', v: 0.001,  d: 0.001,  min: 0.001,  max: 0.01,   step: 0.0001,  fmt: x => x.toFixed(4) },
  mountAmp:   { label: 'peak height', v: 350,     d: 350,     min: 100,    max: 800,    step: 10,      fmt: x => x.toFixed(0) },
  snowLine:   { label: 'snow line',   v: 220,     d: 220,     min: 60,     max: 400,    step: 5,       fmt: x => x.toFixed(0) },
  snowyPct:   { label: 'snowy peaks', v: 10,      d: 10,      min: 0,      max: 100,    step: 5,       fmt: x => x.toFixed(0) + '%' },
  fogDens:    { label: 'fog',         v: 0.00022, d: 0.00022, min: 0.00005,max: 0.0009, step: 0.00001, fmt: x => (x*1000).toFixed(2) },
  floraDens:  { label: 'flora density',v: 0.25,   d: 0.25,    min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  treeSize:   { label: 'tree size',   v: 14,      d: 14,      min: 4,      max: 22,     step: 1,       fmt: x => x.toFixed(0) + 'm' },
  // v9.5: the v4.6 "exaggerated perspective" shrank every tree to 35% by 4 km,
  // so a grove's outline changed shape as you flew at it. Off by default now;
  // this restores the old look in one click.
  treePersp:  { label: 'tree persp',  v: 1,       d: 1,       min: 0,      max: 1,      step: 1,       fmt: x => x > 0.5 ? 'shrink far' : 'true size' },
  treeShare:  { label: 'tree share',  v: 0.55,    d: 0.55,     min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  treeTiers:  { label: 'fronds',      v: 11,       d: 11,       min: 3,      max: 14,     step: 1,       fmt: x => x.toFixed(0) },
  treeFract:  { label: 'tree fractal',v: 0.45,     d: 0.45,    min: 0,      max: 1,      step: 0.05,    fmt: x => (x*100).toFixed(0) + '%' },
  floraRange: { label: 'flora range', v: 5950,    d: 5950,    min: 150,    max: 6000,   step: 50,      fmt: x => x.toFixed(0) },
  juliaRe:    { label: 'flora c·re',  v: 0.22,    d: 0.22,    min: -2,   max: 2,    step: 0.01,    fmt: x => x.toFixed(2) },
  juliaIm:    { label: 'flora c·im',  v: 1,       d: 1,       min: -2,   max: 2,    step: 0.01,    fmt: x => x.toFixed(2) },
  bombAngle:  { label: 'bomb angle',  v: 3,       d: 3,       min: -45,    max: 45,     step: 1,       fmt: x => x.toFixed(0) + '°' },
  cloudCount: { label: 'cloud count', v: 16,       d: 16,       min: 0,      max: 16,     step: 1,       fmt: x => x.toFixed(0) },
  cloudSize:  { label: 'cloud size',  v: 280,     d: 280,     min: 60,     max: 280,    step: 5,       fmt: x => x.toFixed(0) + ' m' },
};

// Copy text to the clipboard, with a fallback: navigator.clipboard needs a
// SECURE CONTEXT, which http://localhost is but http://<lan-ip> (phone testing)
// and file:// are not — so the single-file build and the phone both need the
// old hidden-textarea route. Feedback goes on the button itself; tune.js stays
// import-free on purpose (terrain.js imports it, so any import here that
// reaches weapons/terrain would close a dependency cycle).
export function copyText(text, btn, label) {
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

export function buildPanel(OBJ, panelId, headId, bodyId) {
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
}
