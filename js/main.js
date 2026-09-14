// Entry point: wires the modules together and runs the main loop.
// The per-frame uniform upload + draw + probe readback live here because they
// touch nearly every subsystem (flight, rings, weapons, clouds, tuning).

import { TAN_HALF_FOV, MAXB, MAXBOMB, BLASTC, MAXCLOUD } from './config.js';
import { craft, camPos, viewPos, viewZoom, sun, probe } from './state.js';
import { canvas, gl, U, initRenderer, resize, adjustQuality, setRenderScale, getRenderScale, nextFrame } from './renderer.js';
import { fsSrc } from './shaders.js';
import { TUNE, buildTunePanel } from './tune.js';
import { DBG } from './dbg.js';
import { DEBUG_BUILD } from './dbgflag.js';
import { initInput, IS_TOUCH } from './input.js';
import { update, resetFlight, grindAmt } from './flight.js';
import { initRings, updateRings, packRingData, ringsPosData, ringsMatsData } from './rings.js';
import { initCollectedTex } from './spores.js';
import { bullets, bombs, impacts, bulletUniform, bulletProbePos, gpuBulletGround, gpuBulletPlant,
         bombUniform, gpuBombGround, activeBlast, blastUniform, gpuBlastPlant } from './weapons.js';
import { clouds, cloudArr, genClouds } from './clouds.js';
import { updateHUD } from './hud.js';
import { ensureAudio } from './audio.js';
import { drawTrail, buildFxQueries, fxOcc } from './fx.js';
import { initAliens, packAlienUniforms, alien } from './aliens.js';

// GPU collision probe readback buffer + grind-shake scratch
const probeBuf = new Uint8Array(133 * 4);  // px 0-1 craft · 2-17 bullets · 18-81 blast cells · 82-84 bombs · 85-132 fx occlusion
const fxPosArr = new Float32Array(48 * 3); // overlay occlusion query positions
const alienU = { shipPos: new Float32Array(24), shipLaser: new Float32Array(6), shipMelt: new Float32Array(6),
                 bolts: new Float32Array(24), boltN: 0 };

// cursor visibility (v8.0): 100 = native crosshair, 0 = hidden; in between a
// custom crosshair drawn at that alpha (a native cursor cannot be translucent)
function applyCursor(v) {
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
let lastCursorA = -1;
let wasManualRes = false;   // manual -> auto transition, see frame()

const shakeCam = [0, 0, 0];   // scratch: camPos + grind jitter, uploaded to the GPU

window.__ffBooted = true;   // tells the index.html watchdog the module loaded

// ---- start screen (v5.7) ----
let running = false;
const $status = document.getElementById('loadStatus');
const $startOv = document.getElementById('start');
const $startBtn = document.getElementById('startBtn');
const $pilotName = document.getElementById('pilotName');
const $livery = document.getElementById('liveryColor');
const $pilotTag = document.getElementById('pilotTag');
const setStatus = t => { $status.textContent = t; };
const lockFields = on => {
  $pilotName.disabled = on; $livery.disabled = on;
  document.querySelectorAll('#swatches .sw').forEach(b => { b.disabled = on; });
};
function hexToLin(hex) {
  // sRGB picker value -> the shader's linear-ish color space (gamma 2.2)
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.pow(c / 255, 2.2);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
try {
  $pilotName.value = localStorage.getItem('ff_name') || '';
  const c = localStorage.getItem('ff_color');
  if (c) $livery.value = c;
} catch (e) { /* storage can be unavailable on file:// — fly anonymous */ }

const $swatches = document.querySelectorAll('#swatches .sw');
const markSwatch = () => $swatches.forEach(x => x.classList.toggle('sel', x.dataset.c.toLowerCase() === $livery.value.toLowerCase()));
$swatches.forEach(b => b.addEventListener('click', () => {
  if (b.disabled) return;
  $livery.value = b.dataset.c;
  markSwatch();
}));
$livery.addEventListener('input', markSwatch);
markSwatch();

async function main() {
  setStatus('waking up WebGL2 \u2026');
  await nextFrame();
  // >>> debug bootstrap — build.js CUTS this region out of the artifact >>>
  // The DEBUG build, and the only place it is reached from. DEBUG_BUILD is
  // false unless the dev server was started with --debug, so a normal run --
  // and the double-click artifact, where js/debug.js does not exist at all --
  // never fetches it, never builds the panel, and compiles a shader with no
  // false-colour channels in it (about half the driver compile: docs/COMPILE.md).
  let dbgMod = null;
  if (DEBUG_BUILD) {
    try { dbgMod = await import('./debug.js'); }
    catch (e) { console.warn('debug build requested but js/debug.js did not load:', e); }
  }
  // <<< debug bootstrap <<<
  const fsText = dbgMod ? dbgMod.injectDebug(fsSrc) : fsSrc;
  if (!(await initRenderer(setStatus, lockFields, fsText))) return;
  setStatus('linking flight systems \u2026');
  await nextFrame();

  buildTunePanel();
  if (dbgMod) dbgMod.buildDebugPanel();
  if (IS_TOUCH) setRenderScale(0.6); // heavy shader: start lower on mobile GPUs, auto-scaler adjusts

  genClouds();
  initRings();

  // collected-cells texture lives on unit 1 for the whole session
  initCollectedTex();
  initAliens();
  gl.uniform1i(U.uCollected, 1);
  gl.uniform3f(U.uLivery, ...hexToLin($livery.value));

  // Debug handle for the browser console (read-only inspection)
  window.__fractalFlight = { craft, camPos, sun, probe };

  let lastT = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsShown = 0, fpsTimer = 0;

  function frame(now) {
  // dt is CLAMPED for the physics: a long stall must not integrate one huge
  // step and fling the craft through a mountain. The fps statistic must use
  // the REAL elapsed time though -- accumulating the clamped value pins the
  // readout at exactly 1/0.05 = 20 the moment a frame takes over 50 ms, so it
  // could never report below 20 however slow things actually got. That is not
  // cosmetic: adjustQuality() steers on this number.
  const rawDt = (now - lastT) / 1000;
  const dt = Math.min(rawDt, 0.05);
  lastT = now;

  const { craftBasis, camBasis } = update(dt, now);
  // Resolution scale: 0 = auto (the adaptive scaler), anything else pins it.
  // Above 1 this supersamples -- the browser downsamples the oversized buffer
  // on composite, which is the one antialiasing route with no blur, no
  // ghosting and nothing to tune.
  const manualRes = DBG.resScale > 0.025;
  if (manualRes) setRenderScale(DBG.resScale);
  else if (wasManualRes) setRenderScale(Math.min(getRenderScale(), 1.0));  // back to auto: rejoin the
  wasManualRes = manualRes;                    // adaptive range at once rather than crawling down 0.15 a step
  resize();

  // dynamic resolution: keep it fluid on weak GPUs, crisp on strong ones
  fpsAcc += rawDt; fpsN++; fpsTimer += rawDt;   // real time, not the physics clamp
  if (fpsTimer > 0.75) {
    const fps = fpsN / fpsAcc;
    fpsShown = Math.round(fps);
    if (!manualRes) adjustQuality(fps);   // a pinned resolution wins
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }
  updateHUD(fpsShown, canvas.width, canvas.height);
  if (TUNE.cursorA.v !== lastCursorA) { lastCursorA = TUNE.cursorA.v; applyCursor(lastCursorA); }

  const sunDir = [
    Math.cos(sun.el) * Math.sin(sun.az),
    Math.sin(sun.el),
    Math.cos(sun.el) * Math.cos(sun.az)
  ];

  gl.uniform2f(U.uResolution, canvas.width, canvas.height);
  gl.uniform1f(U.uTime, now / 1000);
  // grind shake: jitter only the rendered camera — camPos itself stays smooth
  if (grindAmt > 0.001) {
    const s = grindAmt * (0.45 + craft.speed * 0.0035);
    shakeCam[0] = viewPos[0] + (Math.random() - 0.5) * 2 * s;
    shakeCam[1] = viewPos[1] + (Math.random() - 0.5) * 2 * s;
    shakeCam[2] = viewPos[2] + (Math.random() - 0.5) * 2 * s;
    gl.uniform3fv(U.uCamPos, shakeCam);
  } else {
    gl.uniform3fv(U.uCamPos, viewPos);
  }
  gl.uniformMatrix3fv(U.uCamMat, false, camBasis.mat);
  gl.uniform3fv(U.uSunDir, sunDir);
  gl.uniform1f(U.uFov, TAN_HALF_FOV);
  gl.uniform2f(U.uJitter, 0, 0); // no temporal accumulation → keep rays fixed = no shimmer
  gl.uniform1f(U.uPixScale, 2 * TAN_HALF_FOV / canvas.height);
  gl.uniform1f(U.uDetailFade, DBG.detailFade);   // A1 footprint-aware detail fade
  gl.uniform1f(U.uRayTol, DBG.rayTol);           // v9.4 A/B: hit tolerance along the ray
  gl.uniform1f(U.uHitRefine, DBG.hitRefine);     // v9.5 A/B: secant refine onto the surface
  gl.uniform1f(U.uMarchStride, DBG.stride);      // v9.5 A/B: minimum stride per unit t
  gl.uniform1f(U.uRelaxMtn, DBG.relaxMtn);       // 13 Sept 2026: step relaxation where the mountains are
  gl.uniform1f(U.uWaterLOD, DBG.waterLOD);       // v9.4 A/B: footprint-aware water ripples
  // v9.4 diagnostics: the whole Debug panel packed into one uniform. In a
  // non-debug build the shader has no channels, the uniform is optimised
  // away, and getUniformLocation returned null -- uniform1f(null, 0) is a
  // no-op, so this costs one call and no branch.
  gl.uniform1f(U.uDebugMask, DBG.mask);
  gl.uniform3fv(U.uCraftPos, craft.pos);
  gl.uniformMatrix3fv(U.uCraftMat, false, craftBasis.mat);
  packRingData();
  gl.uniform4fv(U.uRingsPos, ringsPosData);
  gl.uniformMatrix3fv(U.uRingMats, false, ringsMatsData);
  gl.uniform1f(U.uCockpit, viewZoom.cockpit);
  gl.uniform1f(U.uShadows, TUNE.shadows.v);
  buildFxQueries(fxPosArr, bullets, bombs, impacts);
  gl.uniform3fv(U.uFxPos, fxPosArr);
  packAlienUniforms(alienU);
  gl.uniform3fv(U.uMotherPos, alienU.motherPos);
  gl.uniform3fv(U.uMotherHalf, alienU.motherHalf);
  gl.uniform1f(U.uMotherMelt, alienU.motherMelt);
  gl.uniform4fv(U.uRelay, alienU.relay);
  gl.uniform1f(U.uRelayMelt, alienU.relayMelt);
  gl.uniform2fv(U.uAlienHit, alienU.alienHit);
  gl.uniform4fv(U.uBolts, alienU.bolts);
  gl.uniform1f(U.uBoltN, alienU.boltN);
  gl.uniform4fv(U.uShipPos, alienU.shipPos);
  gl.uniform1fv(U.uShipLaser, alienU.shipLaser);
  gl.uniform1fv(U.uShipMelt, alienU.shipMelt);
  gl.uniform1f(U.uShipN, alienU.shipN);
  gl.uniform3fv(U.uShipHalf, alienU.shipHalf);
  gl.uniform4fv(U.uBoxParam, alienU.boxParam);
  gl.uniform1f(U.uBoxRound, alienU.boxRound);       // hull corner fillet
  gl.uniform1f(U.uOceanSlope, TUNE.oceanSlope.v);
  gl.uniform1f(U.uOceanMax,   TUNE.oceanMax.v);
  gl.uniform1f(U.uMassDecay,  TUNE.massDecay.v);
  gl.uniform1f(U.uMountAmp,   TUNE.mountAmp.v);
  gl.uniform1f(U.uSnowLine,   TUNE.snowLine.v);
  gl.uniform1f(U.uFogDens,    TUNE.fogDens.v);
  gl.uniform2f(U.uJuliaC,     TUNE.juliaRe.v, TUNE.juliaIm.v);
  gl.uniform1f(U.uSnowFrac,   TUNE.snowyPct.v / 100);
  gl.uniform1f(U.uFloraDens,  TUNE.floraDens.v);
  gl.uniform1f(U.uFloraRange, TUNE.floraRange.v);
  gl.uniform1f(U.uTreeSize,   TUNE.treeSize.v);
  gl.uniform1f(U.uTreePersp,  TUNE.treePersp.v);     // v9.5: distance shrink is a knob, default off
  gl.uniform1f(U.uTreeShare,  TUNE.treeShare.v);
  gl.uniform1f(U.uTreeTiers,  TUNE.treeTiers.v);
  gl.uniform1f(U.uTreeFract,  TUNE.treeFract.v);
  probe.pos[0] = craft.pos[0]; probe.pos[1] = craft.pos[1]; probe.pos[2] = craft.pos[2];
  for (let i = 0; i < MAXB; i++) {
    const B = bullets[i];
    if (B) { bulletUniform[i*3] = B.x; bulletUniform[i*3+1] = B.y; bulletUniform[i*3+2] = B.z; }
    else   { bulletUniform[i*3] = 0;   bulletUniform[i*3+1] = -9999; bulletUniform[i*3+2] = 0; }
  }
  gl.uniform3fv(U.uBulletPos, bulletUniform);
  bulletProbePos.set(bulletUniform);   // next frame's readback answers for these
  for (let i = 0; i < MAXBOMB; i++) {
    const B = bombs[i];
    if (B) { bombUniform[i*3] = B.x; bombUniform[i*3+1] = B.y; bombUniform[i*3+2] = B.z; }
    else   { bombUniform[i*3] = 0;   bombUniform[i*3+1] = -9999; bombUniform[i*3+2] = 0; }
  }
  gl.uniform3fv(U.uBombPos, bombUniform);
  if (activeBlast && !activeBlast.uploaded) {
    blastUniform.fill(1e7);
    for (let j = 0; j < activeBlast.cells.length; j++) {
      blastUniform[j*2] = activeBlast.cells[j].x;
      blastUniform[j*2+1] = activeBlast.cells[j].z;
    }
    activeBlast.uploaded = true;   // next readback answers these cells
  } else if (!activeBlast) {
    blastUniform.fill(1e7);
  }
  gl.uniform2fv(U.uBlastCell, blastUniform);
  const cloudN = Math.min(MAXCLOUD, Math.round(TUNE.cloudCount.v));
  for (let ci = 0; ci < MAXCLOUD; ci++) {
    const c = clouds[ci];
    cloudArr[ci * 4]     = c.x;
    cloudArr[ci * 4 + 1] = c.y;
    cloudArr[ci * 4 + 2] = c.z;
    cloudArr[ci * 4 + 3] = c.f * TUNE.cloudSize.v;
  }
  gl.uniform4fv(U.uCloudPos, cloudArr);
  gl.uniform1f(U.uCloudN, cloudN);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // read the collision-probe row (GPU-authoritative ground & tree distance,
  // for the craft AND every airborne tracer — still one readback call)
  gl.readPixels(0, 0, 133, 1, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf);
  probe.ground = ((probeBuf[0] * 65536 + probeBuf[1] * 256 + probeBuf[2]) / 16777215) * 640 - 80;
  probe.plantD = (probeBuf[4] / 255) * 40;
  for (let i = 0; i < MAXB; i++) {
    const o = (2 + i * 2) * 4;
    gpuBulletGround[i] = ((probeBuf[o] * 65536 + probeBuf[o + 1] * 256 + probeBuf[o + 2]) / 16777215) * 640 - 80;
    gpuBulletPlant[i]  = (probeBuf[o + 4] / 255) * 40;
  }
  for (let j = 0; j < BLASTC; j++) gpuBlastPlant[j] = (probeBuf[(18 + j) * 4] / 255) * 40;
  for (let i = 0; i < MAXBOMB; i++) {
    const o = (82 + i) * 4;
    gpuBombGround[i] = ((probeBuf[o] * 65536 + probeBuf[o + 1] * 256 + probeBuf[o + 2]) / 16777215) * 640 - 80;
  }
  for (let i = 0; i < 48; i++) fxOcc.vis[i] = probeBuf[(85 + i) * 4];

  drawTrail(camBasis, now, bullets, bombs, impacts);
  if (running) requestAnimationFrame(frame);
}
  setStatus('spinning up the GPU \u2014 first frame \u2026');
  await nextFrame();
  resize();
  frame(performance.now());   // warm-up: run the full pipeline once (loop not running yet)
  setStatus('Ready for flight');
  $startOv.classList.add('ready');   // spinner disappears, status grows
  $startBtn.style.display = 'inline-block';

  $startBtn.addEventListener('click', () => {
    try {
      localStorage.setItem('ff_name', $pilotName.value);
      localStorage.setItem('ff_color', $livery.value);
    } catch (e) {}
    gl.uniform3f(U.uLivery, ...hexToLin($livery.value));
    const nm = $pilotName.value.trim();
    if (nm) { $pilotTag.textContent = 'PILOT \u00b7 ' + nm.toUpperCase(); $pilotTag.style.display = 'block'; }
    $startOv.style.display = 'none';
    initInput(resetFlight);   // inputs bind only now — typing a pilot name can't steer
    ensureAudio();            // user gesture: engine sound can start right away
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  });
}

main();
