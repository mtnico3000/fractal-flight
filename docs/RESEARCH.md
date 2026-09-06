# Research notes — Mandelbox params, terrain variations, shimmer diagnosis

Full write-up of the research/discussion session (Sept 2026) so the
reasoning survives alongside the ROADMAP action items. Read this before
implementing ROADMAP sections A and B — it explains WHY each fix works and
what was already ruled out.

---

## 1. Mandelbox parameter guide (the Aliens panel sliders)

The Mandelbox iterates three operations per point:
`q = boxFold(q); q = sphereFold(q); q = q·scale + p` (8 iterations in our
`mandelboxDE`, running derivative `dr` for the distance estimate).

**boxFold (slider "box fold")** — `clamp(q, -fold, fold)·2 − q`: any
coordinate beyond ±fold is mirrored back inside, like folding paper. This
is the source of the rectilinear, plated, "machined panels" character.
Folds are reflections (isometries), which is why the DE stays exact.
Larger fold → bigger folded chamber → chunkier slabs; smaller → finer
panel lattice.

**boxMinR (slider "box min r", stored squared as uBoxParam.y)** — the
sphere fold: points inside radius minR are inflated by 1/minR²; points
between minR and 1 are inverted by 1/r². A conformal inversion — the ROUND
counterpart to the fold — producing the bulbs, rosettes and lacy interior
detail that interrupt the plating. Small minR = aggressive blow-ups =
lacier/baroque; large = calmer hulls.

**boxScale (slider "box scale")** — the self-similarity ratio; each
iteration magnifies folded space by `scale` and re-adds the seed point.
2–3 = classic crunchy alien machinery. NEGATIVE values (the slider
deliberately reaches −3) interleave mirrored copies each iteration → the
famous organic "temple/coral" family. **boxScale ≈ −1.5 … −2.8 is the most
rewarding unexplored regime.**

Defaults (2.4 / 1.0 / 0.5): fold and minR are the canonical literature
values; scale 2.4 puts detail sizes in a sweet spot for ship-scale objects
at the 8-iteration budget. Ships are BOX-CROPPED (fractal ∩ exact sdBox in
a unit-cube domain), so sliders never break the silhouette; the crop also
allows any aspect ratio despite non-uniform stretch (DE scaled by the
smallest half-extent = conservative). A rectangular mandelbox could also
be made via per-axis fold limits (still DE-exact since folds stay
isometries) — we chose cropping instead because extreme slab aspects
(20:1 mothership) degenerate a fold-aspect fractal into mush.

Mandelbulb (relay): White–Nylander triplex power-8; per-iteration cost is
trig-heavy (sin/cos/acos/atan2/pow) vs the box's fold/clamp — fine for a
30 m object, wrong for anything screen-filling. Note deep-zoom regions of
bulbs go "whipped-cream smooth"; boxes stay crunchy.

---

## 2. Terrain variations — papers + TerraForge3D + feasibility

### Current terrain (for context)

`terrainShape`: two Mandelbrot DE evaluations → continent mass mask
(exp(−de·massDecay)) + domain-warped ridged fbm mountains (capped by tanh)
+ fbm base with ocean carving + lake mask, composed with smax. Essentially
MONOfractal roughness with a spatial amplitude selector.

### Paper 1 — van Lawick van Pabst & Jense (TNO), multifractal terrain

Key concept: real terrain is MULTIfractal — roughness varies from place to
place; plain fbm cannot do this. Their parameters: α (Lévy index)
controls how often sharp singularities/peaks occur; C1 controls sparseness
of the mean ("roughness"); H the fractal-integration smoothing (β = 2H+1).
Their pipeline (Lévy noise → FFT multi-scaling filter → exponentiate →
fractal-integrate) is grid/offline — NOT shader-portable.

The shader-world equivalent (Musgrave multifractal): weight each fbm
octave by the signal accumulated so far instead of a fixed 0.5 gain —
valleys become smooth, ridges jagged, from the same noise field. Cost: one
multiply per octave (~free). This is ROADMAP B1; expose the coupling
strength as an α-like slider. Must be mirrored in terrain.js.

### Paper 2 — Alam et al. (PLOS ONE 2025), s-convex escape criteria

Generates NEW escape-time fractal families: T(u) = cos(u^m) + αu + β
iterated through a four-stage orbit with s-convex weights (a^s, (1−a)^s),
with proven escape radii. The "behavior shift" = the sets morph
CONTINUOUSLY under α, β, s, m — i.e., every parameter is a morph slider.

Constraint: no practical distance estimator exists for transcendental
iterations → cannot be raymarched as 3D geometry. Use as 2D MASKS — which
is exactly how the game already uses z²+c (the island shape is an
escape-time mask). Concrete use (ROADMAP B3): a "world type" selector
where the continent mask is a cos-type set → alien coastlines and
archipelagos; s/α as continuous world-morph sliders. Mask smoothness:
approximate with smooth/normalized iteration count (our mass mask uses
exp(−de·k); a DE-free mask needs the smooth-escape-time equivalent).
Cost: complex cos per iteration is a few × z²+c; at ~14-18 iterations
once per terrain sample, expect ≈ +10-15% terrain cost if it REPLACES one
of the two mandelDE calls. Same trick can re-skin alienFlora species.

### TerraForge3D gen3 (github.com/Jaysmito101/TerraForge3D, MIT)

Inspected via shallow clone. The gold is
`Binaries/Data/shaders/generation/base_shape/*/shape.glsl`: ~15 analytic
heightfield formulas (mesas, canyons, karst, dunes, terraces, craters,
volcano, rolling hills, cliffs, cracks, waves…), each ~30 lines of
fbm + smoothstep masks + domain warp — the exact primitives our shader
already has. Read in detail: mesas = macro-fbm plateau mask with
erosion-noise tops and edge-softness control; canyons = warped channel
signal (|snoise| width mask) cut to a noisy floor with depth control.
These transplant DIRECTLY into terrainShape as biome variants — no grids,
no baking (ROADMAP B2). Design: low-frequency biome selector field blends
1-2 shapes per region into the smax composition; gate evaluation so each
point pays only its local biome (~10-15% cost). Mirror in terrain.js.
License: MIT (Jaysmito Mukherjee) — keep attribution in README.

NOT portable: their erosion/denoise filters (bilateral/median/gaussian/
guided, thermal-style passes) operate on STORED heightmap rasters —
incompatible with analytic infinite terrain. Only relevant if we ever do
hybrid baking (below). Their DEM tooling (real-world data) and heightfield
GI/self-shadow pyramids are likewise heightmap-specific.

### "Can we afford much more detail?"

In this architecture detail costs nothing to STORE (formulas) but is paid
PER PIXEL PER FRAME. More octaves everywhere = slower. The right lever is
footprint-aware octave count (fade octaves by pixel ground footprint,
`uPixScale·t`): near ground gets MORE octaves than today, far ground
fewer, net cost ≈ flat — and it doubles as the main shimmer fix (below).
The larger architectural option: bake the macro terrain into tiled
heightmap textures, keep analytic micro-detail on top — one texture fetch
replaces two mandelDE evals (net SPEEDUP) and unlocks raster erosion à la
TerraForge, at the cost of the pure-analytic "infinite world" property
(ROADMAP B4, only if wanted).

---

## 3. Shimmer diagnosis (borders crawl, ground sparkles, sea fireflies)

Observed: mountain-top silhouettes, beach/water border, tree contours and
the sea surface shimmer/crawl in motion; the world doesn't feel "solid".

### Causes (stacked, in order of contribution)

1. **One ray per pixel, zero AA, detail beyond Nyquist.** Each frame the
   camera moves slightly; every pixel's ray lands on a different spot of
   sub-pixel fractal detail and the sample flips. This is the ground
   sparkle and the silhouette crawl. `uJitter` is locked to 0 with a
   comment "no temporal accumulation → keep rays fixed = no shimmer" —
   true only for a STATIC camera; in flight it just means the aliasing is
   unfiltered.
2. **Distance-growing hit tolerance.** March accepts a hit at
   `0.01 + 0.0015·t` with relaxed strides; at grazing incidence (exactly
   the mountain-silhouette case) the hit/miss decision flips frame to
   frame.
3. **Full-frequency color layers.** terrainColor strata, alienFlora
   undergrowth, snow/veg masks sample at full frequency regardless of
   distance → texture-space shimmer even where geometry is stable.
4. **Shoreline is a binary material decision** (mat 1 vs mat 2 chosen per
   ray) → beach pixels flip whole shading models frame to frame.
5. **Water specular.** Ripple normals animate by design (fine), but the
   `pow(reflect·sun, 260)` glint is a razor-thin highlight = classic
   specular aliasing/fireflies.
6. **Tree contours.** Thin frond SDFs with Lipschitz margins (×0.45),
   LOD switch at 550 m + distance-shrink — grazing rays flicker.
7. **Adaptive renderScale stepping.** When fps hovers at a threshold the
   buffer resolution changes in 0.05 steps → whole-image resampling shift.

### MEASURED, 6 Sept 2026 (after A1 shipped)

The diagnosis above was reasoned, not measured. It is now measured, and the
ordering it implies has changed.

**Method.** Hover the camera (observation mode, drift < 0.2 m), patch
`gl.readPixels` on the live context to grab a band inside the frame, and
patch the `uJitter` uniform (main.js pins it to 0) to shift the whole
sampling grid by half a pixel. Shimmer = mean |delta luma| between the
unshifted and shifted frame. Two unshifted frames differ by 0.004, so the
measurement floor is ~0.1% of the signal. `test/` cannot do this; it needs a
live GPU.

**Result.** Shimmer energy splits into two populations with completely
different cures:

| view | band | edge pixels (|d| > 20) | share of energy |
|---|---|---|---|
| ground-filling, 488 m | near | 21% | edges 21%, detail 70% |
| ground-filling, 488 m | far | -- | edges 56%, detail 42% |
| high-altitude massif | far | 10% of pixels | edges 59%, detail 39% |

- **Detail shimmer** (small per-pixel deltas, broad) is what A1 removes, and
  it is the majority of the energy in the near field -- the "ground sparkles"
  complaint. A1 cut it by **41% mean / 70% median** there.
- **Edge shimmer** (10% of pixels carrying ~60% of the energy at range) is
  the hit/miss flip at a silhouette. A1 cannot touch it *by construction*:
  no amount of detail fading changes whether a ray hits the mountain. It
  dominates every distant view, which is why A1 only moves the far field 3%.

**Consequences for the ladder.** A1 is done and did its job; the remaining
shimmer is now overwhelmingly A4's (silhouette stabilization: bisection
refine, slower-growing hit tolerance) and then A5/A6. A2 (specular) and A3
(shoreline) stay cheap and worth doing but are not where the energy is.
**A4 should be promoted above A2/A3.**

Also measured: fading detail is a small net WIN on GPU time, as predicted --
+3% throughput at fade 1, +6% at fade 2, with the adaptive render scale held
fixed (compare Mpix/s, never fps: the scaler reacts to fps and hides the
effect). Cold shader compile is unchanged, 83.6 s with A1 vs 82.9 s without
-- measure this by busting the driver's program cache, or a warm reload
reports 9 s and a cold one 80 s for the same code.

### Fixes, in order of value-per-effort (= ROADMAP A items)

1. **Footprint-aware detail fade (A1)** — analytic mipmapping: scale fbm
   octave count/amplitude AND color-detail frequencies by `uPixScale·t`.
   Kills causes 1 (ground part) and 3, reduces 6, and SAVES GPU. Keep the
   terrain.js mirror at full detail (gameplay wants the true surface;
   visual fade is renderer-only). Do first.
2. **Soften the razors (A2)** — distance-lower the glint exponent, flatten
   water/snow normals at range (LEAN-style), clamp specular. Kills 5.
3. **Shoreline band (A3)** — blend water/terrain shading over a small
   `|h − WATER_LEVEL|` band scaled by footprint. Kills 4.
4. **Silhouette stabilization (A4)** — a few bisection refine steps at the
   hit, slower-growing tolerance. Reduces 2 and 6.
5. **Still-camera accumulation (A5)** — when view+craft ~static (esp.
   OBSERVATION mode): jitter uJitter (Halton), average frames in an FBO;
   converges to a perfect AA image in ~0.5 s; falls back to current
   behavior in motion (no ghosting risk). Pairs with locking renderScale
   in O mode (kills 7 there). Great for screenshots/tweaking.
6. **Full TAA with reprojection (A6, gold standard)** — history texture +
   per-pixel depth (we march anyway; write t to a second attachment),
   neighborhood clamping. Kills 1 everywhere, in motion. Watch ghosting on
   craft/rings/bolts. ~a day of work; do after A1-A4 prove insufficient
   alone.

Ruled out: MSAA (meaningless for a fullscreen raymarch quad);
supersampling always-on (renderScale > 1 works on a 4090 but is a brute-
force battery burner — the adaptive scaler already allows it implicitly on
strong GPUs).
