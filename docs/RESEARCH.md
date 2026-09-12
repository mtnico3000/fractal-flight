# Research notes — Mandelbox params, terrain, shimmer, power, the marcher

Full write-up of the research/discussion session (Sept 2026) so the
reasoning survives alongside the ROADMAP action items. Read this before
implementing ROADMAP sections A and B — it explains WHY each fix works and
what was already ruled out. Section 5 is the v9.4 marcher work and section 6 the
third pass that overturned two of its conclusions; between them they are the
list of things measurement proved wrong after reasoning had settled them.
Check both before re-deriving anything about hit tolerance, iteration
budgets, the coastline, or what a "still" camera measures.

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

### ⚠ THE SHIMMER DIAGNOSIS ABOVE WAS ANSWERING THE WRONG QUESTION (8 Sept 2026)

Everything in section 3 is technically sound and was measured honestly. It
was also **largely beside the point**, and the reason is worth more than any
of the fixes.

**The game was running at 683x359 on an Intel Iris Xe, while an RTX 4090 sat
idle at 0% in the same laptop.** Three compounding causes:

1. **The browser picked the iGPU.** No per-app GPU preference existed for
   Chrome, so Windows defaulted it to integrated.
   `powerPreference: 'high-performance'` in renderer.js is only a hint and was
   NOT enough.
2. **The fps counter could not report below 20.** `frame()` clamps `dt` to
   0.05 s for physics; the fps stat accumulated that clamped value, so past
   50 ms a frame it read exactly 20 forever. `adjustQuality()` steers on that
   number, so it could not tell 20 fps from 3 and pinned renderScale at its
   0.4 floor.
3. **On battery the dGPU is held at its idle P-state** — measured 146/150
   samples at P8 / 210 MHz / 5.5 W against a 3105 MHz / 150 W maximum.

Fix all three and the same code runs at 1706x1495 at 37-45 fps, and the
"pixel shifting" simply is not there. Nico, after seeing it: *"it's the low
pixel count (auto, so about 683x359) that made me see the pixels
shifting... We should have started with talking resolution!"*

**Resolution is the strongest antialiasing lever in the game**, measured on a
pinned camera against the DOWNSAMPLED image the compositor actually shows:

| resolution scale | Mpix | frame time | visible shimmer |
|---|---|---|---|
| 1.00 | 0.65 | 1.00x | 2.071 |
| 1.50 | 1.45 | 2.13x | **1.349 (-35%)** |
| 2.00 | 2.58 | 3.69x | **1.000 (-52%)** |

Doubling the pixel count costs ~1.9x frame time (cost is linear in pixels)
and removes ~30% of the visible shimmer. Supersampling beats rendering at
native (-30% vs -21% per doubling) because the downsample averages several
samples into each display pixel — with no blur, no ghosting and nothing to
tune, the exact opposite of A6's trade.

**The methodological lesson, for the next graphics complaint:** ask what
resolution and which GPU FIRST. Measuring fixes against a starved GPU
measures the wrong thing however careful the measurements are. And do not
use the HUD fps counter as an instrument — use median rAF deltas.

### A2–A6 were built, measured, and DROPPED from the mainline (8 Sept 2026)

They live on branch `v9.1` if ever wanted. Recorded so nobody rebuilds them:

| item | measured | why dropped |
|---|---|---|
| A4 silhouette stabilization | far-field edge shimmer −28%, cost −6% throughput | modest gain for real cost once resolution was fixed |
| A2+A3 specular AA + shoreline band | shore −71%, water fireflies −83%, cost −2% | the one Nico could SEE, but he judged it *"ok but had some other aliasing issues which made me prefer the older version"* |
| A5 still-camera accumulation | hover converges, 5x cheaper parked | niche tool, added a freeze/signature machinery |
| A6 TAA + reprojection | **−31% detail, +30% frame-to-frame change** — worse on both axes | needs motion vectors for camera-independent objects; shipped OFF, then dropped |

A1 is kept on the mainline: it is the only one that is a net SPEEDUP (+3%)
as well as a quality gain.

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

---

## 4. Power delivery and what the RTX 4090 actually runs at (9 Sept 2026)

Section 3 ends by admitting the shimmer hunt answered the wrong question: the
real cause was 683x359 on an Intel iGPU while the RTX sat idle. This section
is the follow-up measurement, because *"is the dGPU actually running?"* turns
out to have three separate answers depending on how the laptop is powered.

### Measured on this machine

| power source | pstate | SM clock | draw | note |
|---|---|---|---|---|
| **battery** (8 Sept) | P8, 146/150 samples | 210 MHz | 5.5 W | ~7% of clock. Unusable. |
| **USB-C PD** (9 Sept) | P4-P5 | 855-1710 MHz | 13-20 W | charging at only ~14 W |
| **240 W barrel** (spec) | P0 | up to 2040 MHz boost | up to 150 W | not testable — adapter dead |

Card maximum on this machine is **3105 MHz**.

### The finding that was not expected

```
power.default_limit :  80.00 W     <- what the GPU is capped at
power.max_limit     : 150.00 W     <- what the card can do
```

**The 4090 is running the 80 W profile, not the 150 W one.** One sample
caught it at exactly **1455 MHz**, which is the documented boost ceiling for a
4090 Laptop configured at 80 W TGP (150 W gives up to 2040 MHz). The two
numbers corroborate each other.

⚠️ **Not yet separated:** whether the 80 W cap comes from the USB-C supply or
from G-Helper's profile. `performance_mode` was 0 (Balanced) when measured,
having been 2 (Silent, limits of 80) during the v9.2 shimmer hunt. **Try
Turbo before assuming a new adapter is required** — it may lift without one.

### Scale of the differences

Battery -> USB-C is the enormous jump (~7x the clock). USB-C -> barrel is
roughly **+20-30%** on top: the 80 W -> 150 W step buys about +40% clock
headroom, which does not convert 1:1.

Practical consequence for any future A/B measurement: **take both sides in one
sitting on one power source, and re-check `pstate` before and after.**
Comparing a number taken at 1455 MHz against one taken at 210 MHz is exactly
the trap that produced the A2-A6 saga.

```sh
nvidia-smi --query-gpu=pstate,clocks.sm,power.draw,utilization.gpu --format=csv -l 1
```

### The adapter itself — a latched fault, not a dead brick

Nico's barrel adapter has twice "died" and twice come back after being left
unplugged (once ~10 minutes, once overnight), most recently dying again after
a reboot. That pattern is a **latched protection circuit**, not a failed one:
an OCP/OTP trip sets a latch that removes drive from the converter, and the
latch only clears once the bulk capacitor bleeds below roughly 5% of rated
voltage. Unplugging for minutes clears it; toggling the wall switch does not.

The same symptom is reported on ROG hardware — a Zephyrus GX501 charger that
["didn't work 99% of the time"](https://forums.tomsguide.com/threads/rog-zephyrus-gx501-charger-doesnt-work-99-of-the-time.440961/latest)
then worked after being left unplugged, and a
[G750JZ whose adapter "fixed itself" after 4-6 hours](https://rog-forum.asus.com/t5/rog-gaming-notebooks/g750jz-not-recognizing-ac-power-supply-not-powering-on-or/td-p/671074),
recurring repeatedly. ASUS's own guidance is that recurring abnormal charging
on the original adapter warrants RMA. **Conclusion: replace it.** A latch that
trips this readily indicates a degrading component and will worsen.

### iGPU vs dGPU, since it keeps mattering

The **iGPU** is on the CPU die, shares system RAM and the CPU power budget.
The **dGPU** is the discrete RTX with its own VRAM and up to 150 W. In
**hybrid/Optimus** mode (G-Helper `gpu_mode: 1`, Standard) the display is
physically wired to the *iGPU*, and the dGPU renders into a buffer that is
copied across — so the dGPU is optional and the browser picks. Chrome defaults
to the low-power adapter. `powerPreference: 'high-performance'` is only a
hint; `--force-high-performance-gpu` with a separate `--user-data-dir` is what
actually moves it (Chrome reuses a running instance and ignores the flag
otherwise). G-Helper "Ultimate" MUXes the display straight to the dGPU —
fastest, needs a reboot.


## 5. The marcher: rings, horns, and the boundary that was innocent (12 Sept 2026)

Section 3 chased "shimmer" and found a starved GPU. This is the residue that
survived the resolution fix — and this time it was the code. Everything below
was measured by replicating the shader's march in JS against `js/terrain.js`
(the fp64 mirror) or a JS port of `shipDE`, comparing the shipped marcher
against a high-iteration, low-relaxation reference. The rigs were throwaway;
the numbers are not, so they live here.

### 5.1 The concentric rings WERE the hit tolerance (fixed)

Symptom: thirty-plus rings centred on the viewer, out to the horizon, riding
along with the camera and making ridges, shorelines and tree edges crawl.
**It survived 2x supersampling**, which is what ruled out aliasing.

Cause: `tolRay = 0.01 + 0.0015 * t` is a tolerance measured **along the ray**.
The error it permits *vertically* is that distance divided by the sine of the
incidence angle, so a ray grazing the ground at 1.5 degrees carries a **38x**
amplification. Stop-distance error therefore grows with both range and
flatness, and because `t` advances in steps the error quantises into shells —
the rings are iso-contours of the tolerance itself.

Fix (`marchTerrain`, gated on the `ray tol` debug knob so it stays A/B-able):

```glsl
float inc = mix(1.0, max(abs(rd.y), 0.06), uRayTol);
if (dT < tolRay * inc || dP < tolRay) { ... }
```

Measured, real terrain, camera at 1964 m, 2800 rays:

| marcher | mean hit error | p99 | avg iters | lost hits |
|---|---|---|---|---|
| shipped (pre-fix) | 28.90 m | 354.3 m | 21.8 | 0 |
| incidence-aware | **2.74 m** | **22.1 m** | 22.8 | 0 |

**10.5x on the mean, 16x on p99, for +4.6% iterations.** The `0.06` floor is
what stops a near-horizontal ray from demanding unbounded precision.

### 5.2 The horns on the hull were BUDGET, not tolerance (fixed)

Flying along a rounded mothership corner produced spikes. Same family of
cause, different mechanism: a ray nearly tangent to a large flat face takes
many tiny DE steps, and both box marches had **48 iterations**. Nico was at
ALT 2813 with the hull top at 2800 — 13 m of clearance, so his rays really
were tangent.

1939 rays through the tangency band (0.02–3 degrees below horizontal),
counting only rays a 4000-iteration reference confirms hit:

| step | cap | missed a real surface | avg iters |
|---|---|---|---|
| `t += d` | 48 (was shipped) | 365 (**18.8%**) | 14.1 |
| `t += d` | 192 | 167 (8.6%) | 33.8 |
| `t += d` | **384 (now shipped)** | 25 (**1.3%**) | 42.2 |
| `t += d` | 768 | 0 (0.0%) | 42.6 |
| `t += d * 0.55` | 48 | 390 (20.1%) | 20.9 |
| `t += d * 0.55` | 144 | 326 (16.8%) | 38.8 |
| `t += d * 0.35` | 192 | 344 (17.7%) | 56.1 |

Three findings worth keeping:

- ⚠️ **Step relaxation, which I proposed as the fix, measures WORSE** — 390
  misses against 365 at the same cap, and it stays worse at every cap tried.
  Relaxing the step makes each iteration cover less ground, so a budget-bound
  march gets *less* far before the cap. Do not reach for relaxation to fix a
  tangency miss.
- **Average iterations barely move past 384** (42.2 to 42.6), because the cost
  is paid only by the few grazing rays; the cap is a ceiling, not a workload.
  That is what makes 48 to 384 affordable at all.
- A cheaper idea — bail out at the ray's closest approach to the surface —
  was implemented and **changed nothing** (365 misses at every `graze`
  threshold from 0.02 to 0.20). The DE never rises again before the cap is
  hit, so there is no "past closest approach" to detect. Dropped.

### 5.3 ~~The same fix does NOT transfer to the sea border~~ — WRONG, see §6

⚠️ **Retracted 12 Sept 2026 (later the same day).** This measured a beach
*fan* and generalised. Over a beach seen at 3° from over the sea, 49 of
16 500 rays DO exhaust the budget, and 22 of 22 500 at a ridge — and the
exhaustion was drawn as water. §6 has the corrected measurement and the fix.
The text below is kept as the record of the mistake.

Nico asked directly: *"would you see a way to apply what we did here to the
beach-sea borders?"* Answer: no, because the terrain march is not
budget-bound. Same rig, 884–900 rays at two altitudes:

| view | shipped (150 iters, relax 0.55) | cap-outs | mean err |
|---|---|---|---|
| high beach, ALT 2142 m | avg 39 iters of 150 | **0 / 884** | 6.68 m |
| low beach, ALT 226 m | avg 34 iters of 150 | **0 / 900** | 0.36 m |

Raising the cap to 384 or 768 changes not one digit. The terrain marcher has a
`T_MAX` of 22 km, and that bounds how grazing a terrain ray can be and still
hit anything: at 226 m altitude the shallowest ray reaching ground inside
`T_MAX` is 0.54 degrees, and at 2142 m it is 5.54. The hull has no such bound,
which is exactly why it needed the budget and the beach does not.

### 5.4 The land/water boundary is NOT misplaced (one valid scene of three)

⚠️ **Two of these three scenes were vacuous**: re-checking on 12 Sept
found the ALT 226 m camera *underground* (residual −43 m on every pixel), so
both the shipped and the reference march hit at t = 0.5 and trivially agreed.
The high-beach row is real; the other two are not. §6.1 checks the camera
is above the terrain in every scene.

Cast a 220x110 grid of real pixel rays across the shoreline, classify each one
land/water/sky exactly as the shader does (`tW < tT`), and compare against a
4000-iteration reference march:

| view | pixel rays | misclassified | screen rows affected |
|---|---|---|---|
| ALT 226 m, pitch 3 deg | 24 200 | **0** (0.00%) | 0 of 110 |
| ALT 226 m, pitch 8 deg | 24 200 | **0** (0.00%) | 0 of 110 |
| ALT 2142 m, pitch 10 deg | 24 200 | **0** (0.00%) | 0 of 110 |

**0 of 72 600.** The marcher puts the boundary where the reference puts it.

### 5.5 The wiggly coastline is real geometry, not an artifact

401 contour samples every 10 m of northing along a 4 km stretch:

| measured over | RMS deviation from its own smoothed shape |
|---|---|
| 20 m | 8.4 m |
| 40 m | 11.9 m |
| 100 m | 19.5 m |
| 200 m | 29.8 m |
| 400 m | 52.2 m |
| 1000 m | **107.2 m** |

Self-similar wiggle at every scale — the signature of a fractal contour, not
of a sampling error. The amplifier is the **beach gradient: 2.35%, i.e. 43 m
of horizontal run per metre of rise.** Every metre of terrain noise moves the
waterline 43 m sideways. Over this stretch the shoreline's x ranges by 932 m.

⚠️ **What therefore cannot be fixed in v9.** One ray per pixel means a
boundary flips sub-pixel as the camera moves, and no tolerance change alters
that. The cures are more samples (the `resolution` knob, section 3) or exact
geometry with a depth buffer and mipmaps (v10's rasterised hybrid).

### 5.6 Three of my own conclusions, overturned by measuring them

Recorded because reasoning had been confident in all three.

- **`terrainNormal`'s epsilon: ruled out on an unrepresentative sample.** I
  measured `dot(n, sun)` over t = 800..9000 m at a **flat beach** point, got a
  **0.0%** swing, and declared the epsilon innocent. At the steepest sampled
  mountain point (slope 0.940) the same sweep swings **0.271 to 0.468, 19.7%
  absolute**, with one local extremum — i.e. a band. A null result from the
  wrong sample is not a null result. (It is still not the rings: a 5 m camera
  move changes that shading by **0.02%**.)
- **The compile-time "regression" did not exist.** I reported the raised
  iteration caps costing 212 s of shader compile, off one uncontrolled
  reading. A controlled A/B put the **original** caps at **243 s** — the caps
  were not the cause. One reading is not a measurement; the same trap as the
  clock-state warning in section 4.
- **ROADMAP A4 would not have worked.** Bisection refinement of the hit point
  sits in the backlog as a silhouette fix. Implemented here and measured, it
  improved the hit error by **1.0x** — exactly nothing, because the error is
  in *where the march stops caring*, not in the interpolation once it stops.
  Kept in the roadmap only as a closed null result.

### 5.7 Water sparkle: a Nyquist crossing, not noise

The sea's fireflies appear where the ripple wavelength crosses the pixel
footprint. Faded by footprint rather than by distance, with the specular
exponent falling with it (**260 to 30**) so the highlight widens as the waves
flatten instead of vanishing:

```glsl
float wfoot = t * uPixScale;
float wfade = mix(1.0, 1.0 - smoothstep(1.5, 6.0, wfoot), uWaterLOD);
```

Shipped on at 0.80. Nico: *"the water LOD does fix the sparkling water, very
cool... superb."*

### 5.8 The spreading invasion: why it is deferred, with the cost

Specified by Nico (8 harvesters spawn a second relay; 4 relays duplicate the
mothership), then dropped by him once costed. The renderer takes the whole
fleet as **individual uniforms**; a second mothership plus four relays with
their harvester slots is roughly **+168 vec4 slots against a measured 242 and
a project ceiling of 260** (the GLSL ES 3.0 minimum guarantee is 224). It
needs the fleet moved into a texture first — ROADMAP **C3** — and v10's
rasteriser may replace that renderer entirely. Do not attempt it by adding
uniforms.

### Post-reboot readings, 12 Sept 2026 — the MUX is fixed, the POWER is not

Nico moved the machine to **G-Helper `gpu_mode: 2` (Ultimate / MUX)** and
**`performance_mode: 1` (Turbo)**, and rebooted. Two separate things came out
of measuring it, and they point opposite ways.

**✅ The GPU-selection problem is gone, and section 3's browser advice is now
moot.** In Ultimate mode the display is wired straight to the dGPU: the RTX
reports `display_active: Enabled` and owns the 2560x1600 mode while the Intel
adapter reports no resolution at all. Every browser renders on the RTX with no
flags — confirmed from inside the page, which reports
`ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU ... D3D11)`. So
`--force-high-performance-gpu` is now harmless but pointless, and the
"browsers default to the integrated GPU" trap cannot fire while Ultimate is
set. (It returns the moment the machine goes back to Standard/hybrid.)

**❌ The card is still power-starved, and by more than section 4 assumed.**
Under the game's real load — 90% utilization at 867x550 — it sat at:

| | reading |
|---|---|
| performance state | **P3–P4** |
| SM clock | **975–1290 MHz** (of a 3105 MHz maximum) |
| power draw | **25–29 W** |
| temperature | 49–50 °C (nowhere near thermal) |

And `nvidia-smi -q -d PERFORMANCE` names the reason outright:

```
Clocks Event Reasons
    SW Power Cap      : Active        <- this is what pins the clocks
    HW Thermal Slowdown : Not Active
```

```
Current Power Limit : 55.00 W
Default Power Limit : 80.00 W
Max Power Limit     : 150.00 W
```

⚠️ **The enforced TGP is 55 W — BELOW the card's own 80 W default**, not
merely below the 150 W maximum. That reframes the question this section has
carried since 9 Sept, which was malformed: it was never "is the 80 W cap the
supply or G-Helper?" — 80 W is just the card's base TGP, and something was
holding it to 55.

### ✅ ANSWERED, 12 Sept 2026: it is the SUPPLY, and Turbo cannot fix it

Nico confirmed the machine is on **USB-C PD**. That closes it, and the
elimination is clean:

- **Not G-Helper.** Its config carries no GPU TGP field at all — only the
  CPU/platform `limit_total`/`limit_fast`/`limit_slow`, all at 80 W — and it
  was already in Turbo (`performance_mode: 1`) when the 55 W cap was measured.
- **Not thermal.** 49–50 °C under sustained load, and `HW Thermal Slowdown`
  reads Not Active.
- **Not the browser or the MUX.** Ultimate mode is on, the page renders on the
  RTX, and the clocks are still pinned.
- **It is the supply.** A ~100 W USB-C PD brick has to cover the CPU, the
  chassis and battery charging (measured at 15.5 W of that budget right now)
  before the GPU sees anything, so the platform hands the card 55 W.

And the measured numbers land squarely in the USB-C band of the table above:
25–29 W at 975–1290 MHz, against 13–20 W / 855–1710 MHz for USB-C and up to
150 W / 2040 MHz for the barrel adapter. **Turbo and Ultimate did not move it
out of that band, and nothing in software can** — there is no power to
allocate. The 4090 stays at roughly a third of its clock ceiling until the
barrel adapter is replaced. That makes the adapter a hardware purchase
blocking any further GPU measurement, exactly as concluded on 9 Sept; the
reboot changed which GPU renders, not how much power it may draw.

**Method note, and it cost two failed commands:** `nvidia-smi` rejects
`timestamp` inside `--query-gpu` on driver 592.00, `-c` is *compute-mode* and
not a sample count, and **PowerShell splits an unquoted comma-separated
`--query-gpu=a,b,c` into an array** so the whole option arrives unrecognised.
Quote it, or sample from bash.


## 6. The flutter, second attempt: what actually moves, measured (12 Sept 2026)

Nico's brief, verbatim: *"a mountain top has a form and it should not change
its form while you fly by. a sea coast has a line and that line should not
fluctuate so much. a rounded corner should be rounded, there are no horns or
spikes there to be shown."* And his hypothesis: the beach spikes and the
ridge shifting are the same mechanism as the hull horns (§5.2).

**He was right, and §5.3 was wrong to say otherwise.** §5.3 measured the
terrain march over a *beach fan* and found no budget exhaustion; that was
then generalised to ridges and the waterline. Same mistake as §5.6's
flat-beach normal test. Worse: re-checking the §5.4 boundary rig showed the
camera in two of its three scenes was **underground** (residual −43 m on
every pixel), so "0 of 72 600 misclassified" rested on one scene, not three.
The 0 in that one scene stands.

### 6.1 Method

Everything below is the shipped `marchTerrain` replicated line for line on
the fp64 mirror (relax 0.55, stride `t*0.0018`, cap 150, incidence-aware
tolerance, clamped secant), cast as a full 2D pixel grid, **twice, with the
camera moved 2 m** — one frame of flight. "Flutter" is then a number: pixels
whose land/water/sky class changes between the two frames, *above what a
near-exact reference march (cap 8000, relax 0.25, stride 0.0001, tolerance
×0.02) also changes*. The reference's own count is legitimate parallax.
Every scene checks that the camera is above the terrain first.

### 6.2 What moves and what does not

Four scenes: `high` (ALT 2142, 10° down, 4 km off the coast), `mid`
(800 m, 14°), `sea` (226 m over the water, 3°, looking back at the beach),
`ridge` (650 m, 6°, 2.7 km from the steepest sampled point).

| scene | rays out of budget | class flips, shipped (reference) | hit landed >15 m from the reference | sample shift p99 |
|---|---|---|---|---|
| high | 0 | 6 (8) | 4 | 11.9 m |
| mid | 0 | 13 (8) | 2 | 4.1 m |
| **sea** | **49** | **15 (4)** | 31 | **44.8 m** |
| **ridge** | **22** | **10 (3)** | 90 | 12.7 m |

Three mechanisms, in order of evidence:

1. **Budget exhaustion becomes a hole, and over a beach the hole is water.**
   `marchTerrain` returned `-1` after 150 iterations; the material pass
   reads that as "no terrain", and wherever the ray had already crossed the
   water plane the pixel is drawn as sea. 49 rays in the grazing beach view,
   22 at the ridge, a different set every frame. **The horns, exactly** —
   §5.2's mechanism on the terrain march.
2. **The minimum stride hops small features.** `t += d + t*0.0018` is 5.4 m
   at 3 km; a beach berm shorter than that is stepped over and the ray lands
   up to 45 m further along (p99, sea scene). Hop or no hop flips with the
   camera.
3. **The stop residual biases every altitude band.** The tolerance stop
   leaves the hit above the surface — 1.21 m mean, 3.19 m p99 at 4 km — and
   `terrainColor(pos, n, pos.y, px)` keys sand/vegetation/rock/snow on that
   `pos.y`. On a 2.35% beach a metre is 43 m of sand/green line: 4% of beach
   pixels in the high scene carry a band value >0.25 off the truth. This one
   is spatially smooth and barely flickers frame to frame (band Δ 0.004 mean,
   same as the reference) — it *crawls* rather than flickers, which is the
   remaining ring pattern at steep angles.

Two candidates measured and **cleared**:

- **Texture boil from the residual.** The sand (0.15/m) and vegetation
  (0.6/m) noise sampled at the hit changes frame to frame by 0.090 and 0.255
  for the shipped march — and by **exactly the same** for the reference. It
  is all parallax. The residual pattern is smooth in camera position.
- **Shadow acne.** The shadow ray starts 1 m above the (too-high) hit and
  tests a 2-octave, 13-iteration, unwarped terrain that is not the one drawn.
  In the grazing sea view **12.1% of sunlit land is black that would be lit
  against the true surface** — real, and ugly — but it moves 0.1% between
  frames. Static, not flutter. Parked in the ROADMAP.

### 6.3 The sweep, and what ships

| variant (sea scene) | holes | flips (ref 4) | wrong surface | shift p99 | residual | iters/px |
|---|---|---|---|---|---|---|
| shipped | 49 | 15 | 31 | 44.8 m | 0.24 m | 32.8 |
| exhaustion = hit | 0 | 13 | 45 | 135.8 m | 1.18 m | 32.8 |
| + cap 384 | 0 | 13 | 34 | 75.6 m | 0.25 m | 32.9 |
| + stride 0.0009 | 0 | 12 | 20 | 9.3 m | 0.16 m | 36.3 |
| + stride 0.0004 | 0 | 13 | 8 | 7.4 m | 0.17 m | 39.8 |
| **+ 0.0009 + secant refine** | **0** | **4** | 20 | 6.7 m | 0.07 m | **38.0** |
| + 0.0004 + secant refine | 0 | 4 | 8 | 4.3 m | 0.04 m | 41.5 |
| reference | 0 | 4 | 0 | 0 | 0 | 98.5 |

Reading it: making exhaustion a hit removes the holes but a capped ray is
still crawling far from the surface (shift 136 m), so the cap must also
rise; **the stride is what kills the hop-throughs** (45 → 9 m); **the refine
is what kills the flips** (12 → 4, the reference's own count). Ridge: holes
22 → 0, flips 10 → 4 (ref 3), residual 0.25 → 0.04 m, +18% iterations. High:
residual 1.11 → 0.05 m, sample shift p99 11.9 → 0.8 m — the 4 km beach band
bias is gone.

The refine: on a tolerance stop with the gap still shrinking, secant-
extrapolate along the last two terrain gaps to the crossing (bounded to two
strides), evaluate there; if it crossed, the bracket is bisected three
times; if not, keep it only when closer. Never while the gap is *growing* —
that is a ray cresting a bump, and extrapolation would hand it to the far
side. ~1.7 extra evaluations per pixel.

### 6.4 On the real GPU: the cost is the compiler's, then it isn't

First version: a refine block after the loop, with its own four terrain
evaluations. RTX 4090 at the 55 W cap (§4), 677×785, observation hover:
**old 166 fps → new 100.8** — and 166 is the 165 Hz panel's vsync, so the
real old frame time is ≤ 6.0 ms against 9.9 ms: **≥ +65% frame time for
+17% iterations**, non-additive (refine alone +25%, stride alone invisible
under the cap, together +65%). Driver compile 160 s.

GLSL has no calls; every call site is inlined. The block added four more
copies of `terrainShapeLOD` — the single largest function in the shader —
and the whole loop got slower per iteration. Rewritten so the probe and the
bisection are *phases of the march loop itself* (`phase` 0/1/2..4), leaving
exactly one call site. Same maths, same tests. Then, at 2× supersample
(1354×1570) to get out from under vsync:

| | fps | frame time |
|---|---|---|
| old (refine off, stride 1.8‰) | 10.7 | 93 ms |
| refine only | 10.5 | +2% |
| stride only | 10.3 | +4% |
| **new (refine on, stride 0.9‰)** | **9.4** | **+14%** |
| reference (stride 0.3‰) | 9.1 | +18% |

+14% for the shipped configuration, matching the mirror's +16–18%. Compile
≤ 140 s. Against the 0.3‰ reference on the same frame with the camera at
rest, the old march differs on **2× the non-sky pixels** the new one does
(1.29% vs 0.64%); the new `march budget` debug channel (white = hit the 384
cap) shows no capped pixel in any view tried.

⚠️ **Two measurement traps met here, recorded so nobody re-meets them:** an
fps of ~165 on this machine is the panel, not the shader — supersample to
get a real number; and observation hover has *inertia*, so a "still"
capture within ~2 s of any nudge is measuring the glide.

### 6.5 The trees were doing it on purpose

`plantEval`: `s *= mix(1.0, 0.35, smoothstep(550.0, 4000.0, mt))` — every
tree's **size** is a function of its march distance, shrinking to 35% by
4 km (v4.6, "exaggerated perspective: far groves read as tiny specks that
visibly grow on approach"). A grove's outline therefore changes shape as you
fly at it — the third of Nico's three cases, and not a bug. Now the
`tree persp` knob on the world panel, **default off** (true size); one click
restores the old look. There is also a hard LOD switch at exactly 550 m
between the frond silhouette and a smooth envelope — a ring around the
player where trees change shape — left as is and noted in the ROADMAP.
