// Render-path invariants that fail SILENTLY.
//
// Neither of these throws, logs, or shows up as a wrong pixel. They just make
// the game quietly worse, and both have already happened:
//
//   * the fps counter accumulated the CLAMPED physics dt, so past 50 ms a
//     frame it read exactly 1/0.05 = 20 however bad things got. adjustQuality()
//     steers on that number, so it could not tell 20 fps from 3 and simply sat
//     on the 0.4 render-scale floor -- which is why the game ran at 683x359 and
//     the "shimmer" that drove a whole roadmap section was really just too few
//     pixels. It also produced a published measurement that was wrong.
//   * if the auto-scaler is not told to stand down, it fights a manually
//     pinned resolution and the slider appears to do nothing.

const fs = require('fs');
const path = require('path');
const { check, ok, summary } = require('./harness');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const main = read('js/main.js');
const renderer = read('js/renderer.js');

console.log('render');

check('the fps counter uses real elapsed time, not the physics clamp', () => {
  ok(/const rawDt = \(now - lastT\) \/ 1000;/.test(main),
     'frame() should keep the unclamped delta');
  ok(/const dt = Math\.min\(rawDt, 0\.05\);/.test(main),
     'the physics still needs its clamp -- a stall must not integrate one huge step');
  ok(/fpsAcc \+= rawDt; fpsN\+\+; fpsTimer \+= rawDt;/.test(main),
     'the fps accumulator must use rawDt, or the readout floors at 20');
});

check('a manual resolution scale overrides the auto-scaler', () => {
  ok(/DBG\.resScale > 0\.025[\s\S]{0,120}setRenderScale\(DBG\.resScale\)/.test(main),
     'a pinned resolution must be applied before resize()');
  const m = /if \(([^)]*)\) adjustQuality\(fps\);/.exec(main);
  ok(m, 'adjustQuality must be guarded, not called unconditionally');
  ok(/manualRes/.test(m[1]),
     'adjustQuality must stand down when the resolution is pinned; guard was: ' + (m && m[1]));
  ok(/setRenderScale\(Math\.min\(getRenderScale\(\), 1\.0\)\)/.test(main),
     'switching back to auto must rejoin the adaptive range, not crawl down 0.15 a step from 2x');
});

// Supersampling asks for a buffer larger than the canvas. Unclamped, a 2x
// scale on a wide window can exceed MAX_TEXTURE_SIZE and fail inside resize().
check('the drawing buffer is clamped to the driver texture limit', () => {
  ok(/MAX_TEX/.test(renderer), 'renderer.js should read gl.MAX_TEXTURE_SIZE');
  ok(/const w = Math\.round\(canvas\.clientWidth \* DPR \* renderScale \* lim\);/.test(renderer),
     'resize() must apply the clamp to the computed width');
});

process.exitCode = summary('render') ? 1 : 0;
