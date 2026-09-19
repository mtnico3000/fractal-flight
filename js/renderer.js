// WebGL2 setup: context, shader compilation, uniform locations, resize with
// adaptive render scale. The per-frame uniform upload + draw + probe readback
// live in main.js (they touch nearly every subsystem).

import { vsSrc, fsSrc } from './shaders.js';

export const canvas = document.getElementById('c');
export const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });

export function fatal(msg) {
  const e = document.getElementById('err');
  e.textContent = 'SHADER / GL ERROR\n\n' + msg;
  e.style.display = 'block';
  console.error(msg);
}

// Per-pixel raymarching cost scales with pixel COUNT — cap DPR at 1.0.
let renderScale = 0.85;                    // start a notch below full, adapt up/down
const DPR = Math.min(window.devicePixelRatio || 1, 1.0);
export function setRenderScale(s) { renderScale = s; }
export function getRenderScale() { return renderScale; }
// A manual resolution scale above 1 supersamples: the buffer is bigger than
// the canvas and the browser downsamples it on composite, which is real
// antialiasing with none of TAA's blur or ghosting. Clamped to what the
// driver will actually hand out rather than failing inside resize().
const MAX_TEX = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
export function adjustQuality(fps) {
  if (fps < 32 && renderScale > 0.4) renderScale = Math.max(0.4, renderScale - 0.15); // drop harder, floor lower (iGPU)
  else if (fps > 56 && renderScale < 1.0) renderScale = Math.min(1.0, renderScale + 0.05);
}

export function resize() {
  const lim = Math.min(1, MAX_TEX / Math.max(1, canvas.clientWidth * DPR * renderScale),
                          MAX_TEX / Math.max(1, canvas.clientHeight * DPR * renderScale));
  const w = Math.round(canvas.clientWidth * DPR * renderScale * lim);
  const h = Math.round(canvas.clientHeight * DPR * renderScale * lim);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}
window.addEventListener('resize', resize);

export const nextFrame = () => new Promise(r => requestAnimationFrame(r));

export const U = {};

// Async init (v5.6): what takes 15-20 s at page load is NOT building the
// world (there is no stored geometry — the GPU recomputes every mountain per
// pixel per frame). It is the DRIVER translating the ~800-line looping
// shader into GPU machine code (on Windows: GLSL -> HLSL -> D3D bytecode).
// With KHR_parallel_shader_compile we poll instead of blocking, so the start
// screen stays alive and animated during the wait.
export async function initRenderer(status, lock, fsText = fsSrc) {
  if (!gl) {
    document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:20px">WebGL2 required.</p>';
    return false;
  }
  status('compiling the world shader \u2026');
  await nextFrame(); await nextFrame();   // let the overlay paint first
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsText); gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  if (ext) {
    const parts = ['terrain raymarcher', 'alien flora', 'cumulonimbus', 'ring course', 'water & sky', 'collision probe'];
    let mi = 0, t0 = performance.now();
    while (!gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) {
      await nextFrame();
      if (performance.now() - t0 > 1300) {
        t0 = performance.now(); mi++;
        status('compiling the world shader \u2014 ' + parts[mi % parts.length] + ' \u2026');
      }
    }
  } else {
    // no async compile: the link check below will freeze the tab. Grey out
    // the pilot fields so they don't look clickable while dead (Firefox).
    lock(true);
    status('compiling the world shader \u2014 the browser may freeze for a moment, hang tight \u2026');
    await nextFrame(); await nextFrame();
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    fatal((gl.getShaderInfoLog(vs) || '') + '\n' + (gl.getShaderInfoLog(fs) || '') + '\n' + (gl.getProgramInfoLog(prog) || ''));
    return false;
  }
  lock(false);   // compile done — name & color are live again
  gl.useProgram(prog);

  // fullscreen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const locPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

  ['uResolution','uTime','uCamPos','uCamMat','uSunDir','uFov','uJitter','uPixScale','uDetailFade','uRayTol','uHitRefine','uMarchStride','uRelaxMtn','uTreePersp','uWaterLOD','uBoxRound','uDebugMask','uCraftPos','uCraftMat','uBulletPos','uBombPos','uBlastCell','uCloudPos','uCloudN',
   'uRingsPos','uRingMats','uLivery','uCockpit','uShadows','uFxPos',
   'uMotherPos','uMotherHalf','uMotherMelt','uRelay','uRelayMelt','uAlienHit','uBolts','uBoltN','uLaserA','uLaserB','uShipPos','uShipLaser','uShipMelt','uShipN','uShipHalf','uBoxParam','uOceanSlope','uOceanMax','uMassDecay','uMountAmp','uSnowLine','uFogDens','uJuliaC','uSnowFrac','uFloraDens','uFloraRange','uTreeSize','uTreeShare','uTreeTiers','uTreeFract','uCollected']
    .forEach(n => U[n] = gl.getUniformLocation(prog, n));
  return true;
}
