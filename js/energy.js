// ============ ENERGY (v9.9) ============
// One pool replacing the old RINGS and SPORES counters, because it is now a
// CURRENCY and not two scores: the ring course and the flora both feed it, and
// the plane's laser spends it. Keeping two numbers would have meant choosing
// which one a laser shot drains.
//
// Rates are deliberately lopsided. A ring is worth 100 — one laser — so the
// course is the reliable way to re-arm, while a tree is worth 1, which makes
// strafing flora a slow top-up rather than an alternative. START is 200 so the
// first shot is available immediately and the second has to be earned.
//
// This module owns the number AND its element, and imports nothing: spores.js,
// rings.js, laser.js and hud.js all feed it, so anything it imported back
// would be a cycle. (js/fx.js once reached a name it never imported and the
// modular build froze — see CLAUDE.md. Keeping the leaf a leaf avoids it.)

export const START_ENERGY = 200;
export const RING_ENERGY = 100;   // one ring passed = one laser shot
export const SPORE_ENERGY = 1;    // one tree harvested by the plane
export const LASER_COST = 100;

let energy = START_ENERGY;
const $energy = document.getElementById('energyScore');

export function getEnergy() { return energy; }
export function canFireLaser() { return energy >= LASER_COST; }

function render() {
  $energy.textContent = energy;
  // The readout dims below one shot's worth: the laser refusing to fire has to
  // be legible as "not enough energy" and not as "the button is broken".
  $energy.classList.toggle('spent', energy < LASER_COST);
}

export function addEnergy(n) {
  energy += n;
  render();
}

// Returns false and spends NOTHING when short, so the caller cannot half-fire.
export function spendEnergy(n) {
  if (energy < n) return false;
  energy -= n;
  render();
  return true;
}

export function resetEnergy() {
  energy = START_ENERGY;
  render();
}
