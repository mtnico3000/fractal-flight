import { gl } from './renderer.js';
import { probe } from './state.js';
import { popSound } from './audio.js';
import { pops } from './fx.js';

// ============ SPORE HARVEST (tree collection game) ============
// Trees are collectibles: fly through one and it pops, vanishes, +1 spore.
// Removal is a 512x512 R8 texture (one texel per 26 m plant cell) that
// plantEval consults — so the renderer, the collision probe and the score
// all agree the tree is gone. The world wraps in the texture every ~13.3 km;
// harvesting a tree also clears its distant wrap-twins (invisible in play).
let score = 0;
export function getScore() { return score; }
export function resetScore() { score = 0; $score.textContent = 0; }
const $score = document.getElementById('score');
export const collectedSet = new Set();
let collectedTex = null;
const onePix = new Uint8Array([255]);
export function initCollectedTex() {
  collectedTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, collectedTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 512, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
}
export function collectTreeAt(wx, wy, wz, sndDelay, quiet) {
  // pops the (single) tree of the cell containing (wx, wz)
  const cx = Math.floor(wx / 26), cz = Math.floor(wz / 26);
  const key = cx + ':' + cz;
  if (collectedSet.has(key)) return false;
  collectedSet.add(key);
  const tx = ((cx % 512) + 512) % 512, ty = ((cz % 512) + 512) % 512;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, collectedTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, tx, ty, 1, 1, gl.RED, gl.UNSIGNED_BYTE, onePix);
  gl.activeTexture(gl.TEXTURE0);
  if (!quiet) {
    score++;
    $score.textContent = score;
  }
  popSound(sndDelay || 0, quiet ? 0.10 : 0);
  pops.push({ x: wx, y: wy, z: wz, t0: performance.now() + (sndDelay || 0) * 1000 });
  return true;
}
export function collectTree() {
  // the probe answered for probePos (this frame's uploaded craft position)
  collectTreeAt(probe.pos[0], probe.pos[1], probe.pos[2]);
}
