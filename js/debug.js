// ============ THE DEBUG BUILD ============
//
// Everything diagnostic lives here and NOWHERE else: the knob table, the
// Debug panel (which builds its own DOM -- index.html carries no markup for
// it), and the shader's false-colour block.
//
// This module is reached by ONE dynamic import in main.js, guarded by
// DEBUG_BUILD from js/dbgflag.js, which is false unless the dev server was
// started with --debug. Two consequences, both deliberate:
//   * build.js resolves STATIC imports only, so this file cannot end up in
//     the single-file artifact -- the double-click build ships with no debug
//     anything. test_build.js asserts it.
//   * the shipped shader does not contain the false-colour channels at all,
//     and two of those channels evaluate the terrain (one terrainShape, two
//     terrainNormal = 8 terrain evaluations, ~168k characters once GLSL
//     inlines them -- 31% of the whole program). Measured 14 Sept 2026:
//     leaving them out takes the driver compile from ~92 s to ~47 s.
//     docs/COMPILE.md has the numbers and the method.

import { buildPanel, copyText } from './tune.js';
import { DBG } from './dbg.js';

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
  // 13 Sept 2026: the step is `relax x the vertical gap`, and the safe factor
  // is cos(slope) -- so 0.55 is a safe step only under 56.6 deg, and it could
  // not step safely on 2.6% of this island. From BELOW a ridge the ray crosses
  // the crest BODY (4-10 m thick along the ray) with a step of up to 9.7 m, so
  // the crest was found or missed by sample phase alone: Nico's horns and
  // floating pieces. He flew the slider to its left end and reported "the
  // issue is gone!", then set the shipping default one rung up: **0.30**,
  // safe to 72.5 deg, leaving 0.017% of the island unmarchable against 2.6%
  // at 0.55, for +76% march iterations in a mountain view and +5% over the
  // sea (0.25 was 0.002% at +108%). The relaxation is keyed on the mountain
  // mass, so frames without mountains barely pay. 0.55 is kept at the top of
  // the range as the v9.5 A/B, and the bottom is 0.20 (safe to 78.5) because
  // `peak height` at its own maximum needs 0.22: a tuning slider must not be
  // able to build a world the marcher cannot render.
  // docs/MARCHING.md R1-R2, test/test_march.js, RESEARCH s6.9.
  relaxMtn:   { kind: 'slider', label: 'mtn relax',   v: 0.30, d: 0.30, min: 0.20, max: 0.55, step: 0.05,
                fmt: x => x.toFixed(2) + (x > 0.525 ? ' (v9.5)' : x > 0.275 && x < 0.325 ? ' (safe)' : '') },
  // 13 Sept 2026, Nico: "a version without any alien relays, harvesters or
  // mothership" to tell what moves from what is drawn. Hidden = hulls, beams
  // and their collisions are gone; the invasion economy keeps running under
  // it. Same switch for jul's rings, the one other thing that moves by itself.
  invasion:   { kind: 'slider', label: 'invasion',    v: 1, d: 1, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'hidden' },
  ringsOn:    { kind: 'slider', label: 'rings',       v: 1, d: 1, min: 0, max: 1, step: 1,
                fmt: x => x > 0.5 ? 'on' : 'hidden' },
  // 13 Sept 2026, Nico: "let's try the b option with a cam snap thing".
  // Observation mode only. The chase springs take ~3 s to settle after an
  // arrow tap (0.34 deg of pitch still to go at 1.5 s, measured live), so a
  // screenshot taken sooner is of a moving camera. 'snap' parks the camera at
  // the springs' own rest pose every frame; 'freeze' leaves it where it is
  // while the craft moves. Both tell a settling camera from a changing world.
  obsCam:     { kind: 'slider', label: 'obs camera',  v: 0, d: 0, min: 0, max: 2, step: 1,
                fmt: x => x > 1.5 ? 'freeze' : x > 0.5 ? 'snap' : 'spring' },

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

// Push the panel's live values into the object the GAME reads. Called after
// every control change; without a debug build DBG simply keeps its defaults.
export function syncDebug() {
  DBG.resScale = TUNED.resScale.v;
  DBG.detailFade = TUNED.detailFade.v;
  DBG.rayTol = TUNED.rayTol.v;
  DBG.waterLOD = TUNED.waterLOD.v;
  DBG.hitRefine = TUNED.hitRefine.v;
  DBG.stride = TUNED.stride.v;
  DBG.relaxMtn = TUNED.relaxMtn.v;
  DBG.invasion = TUNED.invasion.v;
  DBG.ringsOn = TUNED.ringsOn.v;
  DBG.obsCam = TUNED.obsCam.v;
  DBG.mask = debugMask();
}

// The Debug panel. Channels are BUTTONS -- one click, no drag, no readout to
// squint at -- because A/B-ing a moving artifact with a slider is unworkable.
// The master remembers what was dialled in, snaps everything to the game's
// defaults, and hands it back on the next click.
function buildDebugPanelInto(OBJ, panelId, headId, bodyId) {
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

// The false-colour channels, spliced into the fragment shader at the
// //__FF_DEBUG_BLOCK__ marker. Kept as text so the shipped shader never
// contains it -- see the header.
export const DEBUG_GLSL = `
  int dmask = int(uDebugMask + 0.5);
  if (dmask > 0) {
    vec3 hp = ro + rd * t;
    vec3 d = vec3(0.0);
    float nch = 0.0;
    if ((dmask & 1) != 0) {
      d += vec3(1.0, 0.25, 0.25) * fract(marchIters / 12.0);          nch += 1.0;
    }
    if ((dmask & 2) != 0) {
      d += vec3(0.25, 1.0, 0.25) * fract(t / 250.0);                  nch += 1.0;
    }
    if ((dmask & 4) != 0) {
      d += vec3(0.30, 0.45, 1.0) * fract(t * uPixScale);              nch += 1.0;
    }
    if ((dmask & 8) != 0) {
      d += vec3(1.0, 1.0, 0.35) * fract(terrainShape(hp.xz) / 4.0);   nch += 1.0;
    }
    if ((dmask & 16) != 0) {
      float turn = length(terrainNormal(hp.xz, t * uPixScale) - terrainNormal(hp.xz, 0.15));
      d += vec3(1.0, 0.35, 1.0) * clamp(turn * 4.0, 0.0, 1.0);        nch += 1.0;
    }
    if ((dmask & 32) != 0) {
      // exactly the term terrainColor uses to fade the undergrowth out
      float cl = 1.0 - smoothstep(3.0, 5.0, t * uPixScale);
      d += vec3(0.35, 1.0, 1.0) * cl;                                 nch += 1.0;
    }
    if ((dmask & 64) != 0) {
      // v9.5: iterations spent, as a ramp; a ray that hit the 384 cap is WHITE.
      // The old 'march steps' sawtooth could not tell 150 from 6.
      float bud = marchIters / 384.0;
      d += (marchIters >= 383.0) ? vec3(3.0) : vec3(1.0, 0.30, 0.10) * bud;   nch += 1.0;
    }
    col = d / max(nch, 1.0);
    if (mat == 0) col = vec3(0.02);          // leave the sky dark
  }
`;

// Splice the channels into the shipped shader at its marker.
//
// The marker is matched with a REGEX, not a string: core.autocrlf is true on
// this project, so js/shaders.js is CRLF on disk and the line the server hands
// the browser ends CR-LF. A literal "...__FF_DEBUG_BLOCK__\n" matches on a
// fresh LF checkout and silently fails on a normal Windows one -- breaking only
// the debug build, and only for whoever cloned last.
const MARK_RE = /[ \t]*\/\/__FF_DEBUG_BLOCK__[^\n]*\n/;
export function injectDebug(fsText) {
  if (!MARK_RE.test(fsText)) throw new Error('debug: the shader marker is gone from js/shaders.js');
  return fsText.replace(MARK_RE, DEBUG_GLSL.replace(/^\r?\n/, '') + '\n');
}

// Build the Debug panel and its DOM. #panels is a column-reverse stack, so
// appending last puts Debug on top, where index.html used to place it.
export function buildDebugPanel() {
  const host = document.getElementById('panels');
  const panel = document.createElement('div');
  panel.id = 'tuneD'; panel.className = 'closed';
  panel.innerHTML = '<h2 id="tuneDHead">Debug <span class="caret">\u25b8</span></h2>' +
                    '<div class="body" id="tuneDBody"></div>';
  host.appendChild(panel);
  buildDebugPanelInto(TUNED, 'tuneD', 'tuneDHead', 'tuneDBody');
  // Every control writes t.v directly, so rather than thread a callback
  // through the panel builder, catch the events on the way out: both fire
  // in the bubble phase, AFTER the control's own handler has run.
  panel.addEventListener('input', syncDebug);
  panel.addEventListener('click', syncDebug);
  DBG.on = true;
  syncDebug();
}
