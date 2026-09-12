// The tuning panels as DOM, in jsdom.  (v9.4)
//
// Promoted from a throwaway probe because it caught a real bug: the Debug
// master restored every knob from a slot that a first activation had never
// filled, so the FIRST press of DEBUG wiped whatever had just been dialled in.
// That is invisible in the model and only shows through the DOM, which is why
// no other suite could have caught it -- test_tune.js checks the knob objects,
// never the panel built from them.
//
// Needs `npm install` (jsdom). run_tests.js keeps going without it.

const fs = require('fs');
const path = require('path');
const { check, eq, ok, summary } = require('./harness');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.log('panels\n  SKIPPED — needs `npm install` (jsdom).\n' +
              '         Dev tooling only; the game itself has no dependencies.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

// Inline the real stylesheet: the Debug master and the defeated banner both
// work by toggling a CLASS, and whether that actually hides anything is a CSS
// question. A jsdom without the stylesheet would report every element visible.
function boot() {
  const html = read('index.html').replace('</head>', '<style>' + read('css/style.css') + '</style></head>');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
                                url: 'http://localhost:8734/' });
  const win = dom.window;
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {},
                            addEventListener() {}, removeEventListener() {} });
  const src = read('js/tune.js').replace(/^import\s[^;]*;/gm, '').replace(/^export\s+/gm, '');
  const mod = new win.Function('document', 'navigator',
    src + '\nreturn { TUNE, TUNEA, TUNED, debugMask, buildTunePanel };')(win.document, win.navigator);
  mod.buildTunePanel();
  return { win, doc: win.document, mod };
}

console.log('panels');

check('all three panels build into the non-overlapping column', () => {
  const { doc } = boot();
  ok(doc.getElementById('panels'), 'the flex column wrapper is missing');
  for (const id of ['tune', 'tuneA', 'tuneD']) {
    const p = doc.getElementById(id);
    ok(p, id + ' panel is missing');
    eq(p.parentElement.id, 'panels',
       id + ' must live in the column, or expanding it can draw over another panel');
  }
  ok(doc.querySelectorAll('#tune input[type=range]').length > 0, 'Tuning built no sliders');
  ok(doc.querySelectorAll('#tuneD .dbtn').length >= 7, 'Debug should have a master plus six channels');
});

check('the debug channels pack into the bitmask the shader reads', () => {
  const { win, doc, mod } = boot();
  const click = label => [...doc.querySelectorAll('#tuneD .dbtn')]
    .find(b => b.textContent === label)
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  eq(mod.debugMask(), 0, 'nothing on');
  click('hit distance');
  eq(mod.debugMask(), 2, 'hit distance is bit 2');
  click('colour LOD');
  eq(mod.debugMask(), 34, 'colour LOD is bit 32, so 2 + 32');
  click('hit distance');
  eq(mod.debugMask(), 32, 'turning one off leaves the other');
});

// THE BUG. Dial settings in, press DEBUG once: the master used to restore every
// knob from `_user`, which a first activation had never written, so it fell back
// to the defaults and silently discarded the setup.
check('the master hands back what was dialled in, and never wipes it', () => {
  const { win, doc, mod } = boot();
  const T = mod.TUNED;
  const click = label => [...doc.querySelectorAll('#tuneD .dbtn')]
    .find(b => b.textContent === label)
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const drag = (label, v) => {
    const row = [...doc.querySelectorAll('#tuneD .trow')]
      .find(r => r.querySelector('label').textContent === label);
    const s = row.querySelector('input');
    s.value = v;
    s.dispatchEvent(new win.Event('input', { bubbles: true }));
  };

  eq(T.master.v, 0, 'the panel must boot with the master OFF, i.e. the normal world');
  drag('resolution', 2);
  drag('detail fade', 0);
  ok(T.master.v > 0.5, 'touching a control should arm the master, or DEBUG would ' +
                       'read off while a setting was live');
  click('hit distance');

  click('DEBUG');                       // -> off
  eq(T.master.v, 0, 'master off');
  eq(T.resScale.v, T.resScale.d, 'off must mean exactly the game default');
  eq(T.detailFade.v, T.detailFade.d, 'off must mean exactly the game default');
  eq(mod.debugMask(), 0, 'and no false-colour channel');

  click('DEBUG');                       // -> on again
  eq(T.resScale.v, 2, 'the dialled-in resolution must come back');
  eq(T.detailFade.v, 0, 'the dialled-in detail fade must come back');
  eq(mod.debugMask(), 2, 'and the channel selection must come back');

  // and it has to survive repeated toggling, not decay
  click('DEBUG'); click('DEBUG');
  eq(T.resScale.v, 2, 'still 2 after a second round trip');
  eq(mod.debugMask(), 2, 'still bit 2 after a second round trip');
});

// ...and the guard BEHIND that, which the round-trip above cannot reach. Once
// armMaster() ships, a knob is only ever non-default while the master is on,
// so turning the master ON always finds a saved _user and the fallback never
// runs -- the mutation battery proved that by escaping. It is still the thing
// that broke: restoring invented o.d for knobs it had never saved, and wiped a
// dialled-in setup. Any future path that sets a knob WITHOUT arming the master
// -- a PASTE JSON to match the COPY JSON button, a URL preset, a saved profile
// -- walks straight back into it, so the contract is asserted directly:
// turning the master on must hand back what is there, never a default.
check('turning the master ON never invents a value it did not save', () => {
  const { win, doc, mod } = boot();
  const T = mod.TUNED;
  const debug = [...doc.querySelectorAll('#tuneD .dbtn')].find(b => b.textContent === 'DEBUG');

  // Exactly what an import would do: write the model, leave the master alone.
  T.resScale.v = 2;
  T.waterLOD.v = 0;
  eq(T.master.v, 0, 'precondition: the master has never been pressed');
  ok(T.resScale._user === undefined, 'precondition: nothing has been saved yet');

  debug.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  eq(T.master.v, 1, 'the press turned it on');
  eq(T.resScale.v, 2, 'an unsaved knob must be left alone, not reset to its default');
  eq(T.waterLOD.v, 0, 'and so must one whose default is not zero');
});

check('the slider DOM follows the model when the master moves it', () => {
  const { win, doc, mod } = boot();
  const click = label => [...doc.querySelectorAll('#tuneD .dbtn')]
    .find(b => b.textContent === label)
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const row = label => [...doc.querySelectorAll('#tuneD .trow')]
    .find(r => r.querySelector('label').textContent === label);
  const r = row('water LOD');
  r.querySelector('input').value = 0;
  r.querySelector('input').dispatchEvent(new win.Event('input', { bubbles: true }));
  eq(r.querySelector('.val').textContent, 'off (old)', 'the readout should track the drag');
  click('DEBUG');                       // -> off, snaps back to d = 0.80
  eq(Number(r.querySelector('input').value), mod.TUNED.waterLOD.d,
     'the slider position must follow, not just the model');
  ok(/0\.80|on/.test(r.querySelector('.val').textContent),
     'and so must the readout, got ' + r.querySelector('.val').textContent);
});

// The banner replaces the counter IN PLACE, and only when the whole invasion is
// gone -- bombing every harvester under a live mothership just means it builds
// more, so declaring victory there would be a lie.
check('INVADERS DEFEATED only when the whole invasion is dead', () => {
  const { win, doc } = boot();
  const src = read('js/hud.js').replace(/^import\s[^;]*;/gm, '').replace(/^export\s+/gm, '');
  const hud = new win.Function('document', src + '\nreturn { setFleetCounts };')(doc);
  const counters = doc.getElementById('fleetCounts');
  const banner = doc.getElementById('defeated');
  const vis = e => win.getComputedStyle(e).display !== 'none';

  eq(banner.textContent, 'INVADERS DEFEATED', 'banner wording');
  for (const [h, r, m] of [[2, 1, 1], [0, 1, 1], [0, 0, 1], [0, 1, 0]]) {
    hud.setFleetCounts(h, r, m);
    ok(vis(counters) && !vis(banner),
       'still fighting at ' + [h, r, m].join('/') + ' — the counter must stay');
  }
  hud.setFleetCounts(0, 0, 0);
  ok(!vis(counters) && vis(banner), 'all dead: the banner takes the counter’s place');
  hud.setFleetCounts(1, 0, 0);
  ok(vis(counters) && !vis(banner), 'a fresh harvester must retract the banner');
});

process.exitCode = summary('panels') ? 1 : 0;
