// ============ TUNING PANEL ============
// Each knob: v = live value, d = default, min/max/step, fmt = display formatting.
// ---- alien fleet knobs (v9.0): second panel, bottom-right ----
export const TUNEA = {
  boxScale: { label: 'box scale',   v: 1.6,   d: 1.6,   min: -3,   max: 3,     step: 0.1,  fmt: x => x.toFixed(1) },
  boxFold:  { label: 'box fold',    v: 0.7,   d: 0.7,   min: 0.3,  max: 1.6,   step: 0.05, fmt: x => x.toFixed(2) },
  boxMinR:  { label: 'box min r',   v: 0.8,   d: 0.8,   min: 0.1,  max: 1.0,   step: 0.05, fmt: x => x.toFixed(2) },
  bulbPow:  { label: 'bulb power',  v: 10,    d: 10,    min: 2,    max: 12,    step: 1,    fmt: x => x.toFixed(0) },
  moLen:    { label: 'mother len',  v: 3000,  d: 3000,  min: 400,  max: 5000,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moWid:    { label: 'mother wid',  v: 2000,  d: 2000,  min: 200,  max: 3500,  step: 50,   fmt: x => x.toFixed(0) + ' m' },
  moHei:    { label: 'mother hgt',  v: 310,   d: 310,   min: 30,   max: 400,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  moAlt:    { label: 'mother alt',  v: 2200,  d: 2200,  min: 1500, max: 15000, step: 100,  fmt: x => x.toFixed(0) + ' m' },
  shLen:    { label: 'ship length', v: 780,   d: 780,   min: 80,   max: 1200,  step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shWid:    { label: 'ship width',  v: 330,   d: 330,   min: 20,   max: 800,   step: 10,   fmt: x => x.toFixed(0) + ' m' },
  shHei:    { label: 'ship height', v: 120,   d: 120,   min: 8,    max: 300,   step: 2,    fmt: x => x.toFixed(0) + ' m' },
  shSpeed:  { label: 'ship speed',  v: 30,    d: 30,    min: 2,    max: 60,    step: 1,    fmt: x => x.toFixed(0) + ' m/s' },
  relSize:  { label: 'relay size',  v: 30,    d: 30,    min: 10,   max: 80,    step: 2,    fmt: x => x.toFixed(0) + ' m' },
};

export const TUNE = {
  shadows:    { label: 'shadows',     v: 1,       d: 1,       min: 0,      max: 1,      step: 1,       fmt: x => x > 0.5 ? 'on' : 'off' },
  detailFade: { label: 'detail fade',v: 1,      d: 1,       min: 0,      max: 2,      step: 0.05,    fmt: x => x < 0.025 ? 'off' : x.toFixed(2) },
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
}
