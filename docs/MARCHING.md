# Camera-keyed geometry glitches — one law, and the rules that prevent them

*Written 13 Sept 2026, after the sixth bug in this family was fixed. Nico:
"we spent way too much time on this... I'd like a documentation for further
dev to have a very clear way of not having this problem again."*

This file exists because six separate bugs, hunted one at a time over weeks,
turned out to be **the same bug**. Rounded-corner "horns" on the alien hulls,
concentric rings on the ground, spikes of sea into the beach, the flickering
waterline, peaks that "breathe" as you fly at them, and tree crowns that
change shape at distance — all one mechanism, wearing six costumes. Nico
called it from the third one on (*"I am 99% positive that it's the same glitch
as the beach one, and the rounded borders one"*) and he was right every time.

Read this before you touch the terrain, the march, or any SDF in the world.

---

## 1. The symptom, and how to recognise it in one look

> **Something that should be nailed to the world changes shape as the camera
> moves — and it changes back.**

The tell is the *changing back*. Parallax is **monotonic**: fly at a peak and
it can only get progressively more pointed, never pointed → rounded → pointed.
Anything that **cycles** as you move in a straight line is not perspective, it
is the renderer. That single observation is worth more than any frame-by-frame
metric, and it is what finally cracked this: *"it goes from pointy to less
pointy and back to pointy in a loop while you advance in one direction."*

Related tells, all the same thing:

- a jagged "comb" of horns along a ridge or a rounded edge, moving every frame;
- a sliver of geometry floating detached above the thing it belongs to;
- the effect is **faster near the centre of the screen** and slows toward the
  edges (moving along the view shifts the sample grid by the full step on a
  central ray, and by only `cos θ` of it on a ray at angle θ);
- it happens at **certain places and not others**, always the same places;
- resolution, detail fade, LOD range and iteration budget all fail to change it.

---

## 2. The law

A raymarcher does not know the world. It knows **the points it chose to
sample**, and it chose them by walking outward from the camera.

> **Every world feature thinner than the local sample spacing is found or
> missed depending on where the camera stands. Move the camera and the whole
> sample lattice slides along the ray, so the answer flips — periodically,
> because the lattice is periodic.**

Everything below is a corollary. Four quantities decide what the marcher can
see, and **every one of them has shipped a bug in this project**:

| # | quantity | in `marchTerrain` | failure mode | bugs it caused |
|---|---|---|---|---|
| 1 | **Spacing** — how far the ray moves per step | `relax × gap` and the floor `t × uMarchStride` | steps *over* a thin feature entirely | breathing peaks (§6.9), crest clip (§6.7), beach berms (§6) |
| 2 | **Acceptance** — how close counts as a hit | `tolRay = 0.01 + 0.0015·t`, × incidence | stops *short*, placing the surface metres above itself | concentric rings (§5.1), altitude/colour bands sliding 43 m |
| 3 | **Termination** — when the ray gives up | the 384 cap, `T_MAX` | stops in mid-air and reports something arbitrary | hull horns (§5.2), sea spikes into the beach (§6) |
| 4 | **The field itself** — what is sampled | `terrainShapeLOD(p, t·uPixScale)` | the *world* changes with distance, so it morphs as you approach | octave-fade sinking, the 550 m tree pop |

Note 1 and 2 scale with distance from the camera by construction, and 4 is
*defined* in terms of it. That is why this whole family is camera-keyed: the
marcher's accuracy is a function of where you are standing, so the world's
apparent shape is too.

---

## 3. Why *this* world is unusually prone to it — measured

Run `node test/slope_census.js` to reproduce all of this.

### 3.1 The safe step

The march steps a fraction of the **vertical gap** between the ray and the
heightfield. That is a lower bound on the true distance to the surface only up
to a slope. For a face of angle θ, the nearest rock to a point `g` vertically
above the surface is `g·cos θ` away:

```
safe relaxation = cos(θ_max) = 1 / sqrt(1 + L²),   L = |∇h|
```

⚠️ **Not `1/tan θ`.** The first write-up of the fix said `1/tan`, which agrees
to 6% at 70° and 14% at 56° — close enough to look right, wrong enough to
justify an unsafe step. `test/test_march.js` pins the formula for that reason.

| relaxation | safe up to | fraction of this island it CANNOT step safely |
|---|---|---|
| **0.55** (the v9.5 bug, kept at the slider top for A/B) | 56.6° | **2.589%** |
| 0.45 | 63.3° | 0.643% |
| 0.35 | 69.5° | 0.072% |
| 0.30 | 72.5° | 0.017% |
| **0.25 — the default since 13 Sept 2026** | 75.5° | **0.002%** |
| 0.20 (slider floor) | 78.5° | 0.001% |

That last column *is* the bug, quantified: 2.6% of the island could not be
marched safely, and 2.6% of an island is exactly "certain ridges, always the
same ones".

### 3.2 The steepness has a heavy tail, and the tail does not converge

113 297 land points, gradient at 0.5 m: median **16.7°**, p90 45.0°, p99
61.5°, p99.9 68.7°, max 80.9°. Almost all of this world is gentle. And:

| grid step | land points | max slope found |
|---|---|---|
| 200 m | 2 550 | 72.9° |
| 100 m | 10 188 | 72.9° |
| 50 m | 40 731 | 79.7° |
| 30 m | 113 297 | 80.9° |

**The measured maximum does not converge — look harder, find steeper.** It is
a fractal surface; there is no measurable Lipschitz constant, only a lower
bound. This is the single most important fact in this file, because it means
*you cannot make the march provably safe by measuring the terrain*. You set
the relaxation from a **percentile** and accept a thin tail, or you **bound the
gradient at construction**.

### 3.3 Where the steepness actually comes from

Freeze one factor at a time at the ten steepest points (census section 3):

- **Nine of ten are the ridged fbm's crease.** `1 - |2n-1|` — `abs()` is a
  crease generator, and a crease is where a Lipschitz constant lives. Freeze
  the ridge term and 74° collapses to 0–20°.
- **The very steepest is `mass`.** `mass = exp(-wde · 0.0011)` multiplies a
  460 m mountain amplitude, so it lands on the terrain as
  `0.506 × mass × |∇wde|` metres per metre. And `wde` is a **Mandelbrot
  distance *estimate***: a true distance function is 1-Lipschitz, this one has
  median `|∇| = 0.64` but reaches **23.5** on filaments. At `|∇wde| = 1` that
  is 26.8° of ground; at 23.5 it is **85.2°**. It exceeds 1.5 on 0.78% of land
  and 3.0 on 0.02% — a thin set, which is why the glitch was always local.

Nothing in `exp(-wde · 0.0011) × 460` *looks* steep. That is the trap: **a
gentle-looking multiplier times a large amplitude is a cliff**, and neither
factor looks guilty on its own.

### 3.4 Two plausible levers that are dead — do not re-try them

| idea | result | why |
|---|---|---|
| Round the ridge crease (`sqrt(x²+ε²)` for `abs`) | **max slope unchanged** (80.9° at ε = 0 … 0.20) and the terrain moves up to 77 m | it softens the crease but not the `mass` tail, and it reshapes the world for nothing |
| Raise the relaxation with distance, since the LOD fade smooths detail | **max slope 72.5° at every footprint out to 6.4 km** | the steepness lives in the *low-frequency* structure, which never fades |
| Cap the step at a fraction of the secant-predicted crossing | **no change at all** (30 px error → 30 px) | approaching a wall across a valley, the gap is *growing*; a vertical gap cannot see a wall coming |

---

## 4. The rules

### R1 — The step must be a proven lower bound on the distance to the surface

Not "0.55 looks fine". `relax ≤ cos(θ)` for the θ you intend to support, and
you must be able to say what θ is. Anything above it is a coin toss decided by
sample phase. `js/shaders.js` → `float relax = mix(0.55, uRelaxMtn, …)`.

### R2 — You cannot measure a fractal's Lipschitz constant. Bound it, or budget the tail

§3.2. Two honest postures, and you must pick one *consciously*:

- **Bound it at construction** — build the field so `|∇h|` is analytically
  capped (see R3). Then `cos` gives you a provably safe step.
- **Budget the tail** — set the relaxation from a percentile, and record the
  fraction of the world you are knowingly failing on. That is what ships
  today: `test/test_march.js` asserts that fraction stays known.

What you may not do is quote a measured max as if it were a bound.

### R3 — Every field you multiply by an amplitude contributes `amplitude × |∇field|` to the slope. Know both

The arithmetic that produced the worst ground in this world:

```
mass = exp(-wde * 0.0011)          |∇wde| up to 23.5  (NOT 1, it is an estimate)
mountain ≈ 460 m * ridged * mass   ⇒ 0.506 * mass * |∇wde|  m/m  ⇒  85°
```

Before adding any term, write down its amplitude and the maximum gradient of
every field it multiplies. In particular:

- **A distance *estimate* is not a distance.** Mandelbulb/Mandelbox/Mandelbrot
  DEs are not 1-Lipschitz near the boundary. Assume they are not.
- **`abs`, `min`, `max`, `step` create creases** — bounded gradients, but the
  bound is where the trouble is. `smin`/`smax`/`tanh` are the rounded forms,
  and this codebase already uses them for exactly this reason
  (`mountain = 460·tanh(mountain/460)` — "domed peaks, no razor tips").
- **A narrow `smoothstep` mask times a big height difference is a cliff**:
  slope ≈ `amplitude × 1.5/band × |∇field|`. (Checked here for the `tall`
  selector — it contributes only ~9°, so it is innocent. Check yours.)
- **fbm: each octave contributes `(persistence × lacunarity)^i` to the
  gradient.** At the classic p = 0.5, l = 2 that product is exactly **1**, so
  every octave adds the *same* slope and `|∇h|` grows linearly with octave
  count while the height converges. **If you want detail without steepness,
  use `p × l < 1`.**

### R4 — Nothing in the world may be thinner, along the ray, than the step that reaches it

Measured on one of Nico's rays: the crest was **4.3 m thick** along the ray
where the ray crossed it; the last step before the face — taken over the
valley in front, where the vertical gap is 17.5 m — was **9.7 m**. Either
shorten the step (R1) or thicken the feature. A knife-edge crest, a razor
berm, an isolated spike: if the world contains one, the march must be able to
resolve it at every distance it is visible from.

### R5 — Termination must degrade to the nearest surface, never to a sentinel

A ray that exhausts its budget is *at* the surface it was crawling along, not
in the sky. Returning `-1` made the material pass draw **sea** wherever the
ray had crossed the water plane — a spike of ocean into the beach. The horns
on the hulls were the same bug on the other march. **A miss is not a small
error; it is a different material.** Every fallback path returns the
least-wrong answer.

### R6 — A tolerance measured along the ray is an error budget divided by `sin(incidence)`

`tolRay` is a distance *along the ray*, but the thing it bounds is a *vertical*
gap, so the vertical error is `tolRay / sin(incidence)` — a 38× amplification
at 1.5° of depression. That produced viewer-centred concentric rings for the
entire life of the project, and they survived 2× supersampling because they
were geometry, not aliasing. Fixed with `tolRay * max(abs(rd.y), 0.06)`.
**Any new tolerance gets the same treatment, or it is a ring generator.**
(The plant stop still does not do this — see §7.)

### R7 — Anything keyed on distance-from-camera must be continuous, sub-pixel, and keyed on the FEATURE

Three separate failures of this one rule:

- **Continuous**: the A1 octave fade is a `smoothstep`, so detail dissolves
  instead of popping. ✅
- **Toward the right value**: a faded octave must decay toward the octave's
  **mean**, never toward zero — fading toward zero lowers the average height
  and distant mountains visibly *sink* as you fly at them. `NOISE_MEAN`,
  `RIDGE_MEAN`. ✅
- **Keyed on the feature, not the sample**: `plantEval`'s frond→envelope
  switch at 550 m is keyed on the *sample's* march distance, so a single tree
  straddling the boundary is drawn half detailed and half blob, and the
  boundary sweeps through it as you fly. ❌ **still open.**

### R8 — Prove it by moving the camera, not by looking at a frame

This is why it took weeks. Per-frame error against a reference marcher said
the march was *fine* — because a crest tip is a handful of pixels and the
defect is **temporal**. The metric that works:

1. Fix a scene. March it with the shipped settings and with a reference
   (relax 0.15, floor 0.0001, cap 20 000).
2. **Slide the camera** along the view in small steps.
3. Count **flips** — how often a pixel's answer changes *against* the
   direction of travel — not per-frame error.

And test all three regimes: **looking down, level, and looking up**. Two bugs
hid for weeks because every rig looked down at the terrain. The from-below
case is the dangerous one: that is where a ray crosses a crest's *body*.

Rigs live in the session scratchpad; `test/slope_census.js` is the permanent
one. The reusable pattern is in RESEARCH §6.7–6.9.

---

## 5. Checklist — adding or changing a terrain term

1. **What is its amplitude, and the max gradient of every field it
   multiplies?** (R3.) Write the product down. If you cannot bound a field's
   gradient, you have not finished designing it.
2. **Does it introduce `abs`/`min`/`max`/`step`?** Use the rounded form
   (`smin`, `smax`, `tanh`, `sqrt(x²+ε²)`) unless you have decided to pay for
   the crease.
3. **Does it create features thinner than the march step at the distances they
   are seen from?** (R4.)
4. **Run `node test/slope_census.js`.** If the percentiles moved, the
   relaxation must be re-derived — and the cost re-priced, because it is paid
   by every ray in the frame, not just the ones that touch the new feature.
5. **Run `node test/run_tests.js`** — `test_march.js` fails if the world got
   steeper than the relaxation slider can fix, and `test_terrain.js` fails if
   the `terrain.js` fp64 mirror or `terrainCheapH` drifted from the GLSL.
6. **Fly it.** Same spot, `O`, then `Y` (mouse orbit off), Debug →
   `obs camera` = `snap`, and tap forward one step at a time. Cycles = you
   broke one of the rules above.

## 6. Checklist — adding an SDF object to the shader

1. **Is the distance function a true lower bound?** If it is an estimate
   (mandelbox, mandelbulb, anything with a `length()` inside a fold),
   multiply by a safety factor. `plantEval` returns `d * 0.45` for exactly
   this reason, and the comment says so.
2. **Iteration budget**: a ray nearly tangent to a large flat face needs a
   *lot* of steps, and running out looks like a **spike**, not a miss. Both
   box marches needed 48 → 384. Average cost barely moves (14.1 → 42.2)
   because only the grazing rays pay. ⚠️ **Step relaxation makes budget
   exhaustion worse**, not better.
3. **Termination returns the surface, not a sentinel** (R5).
4. **Tolerance gets the incidence factor** (R6).
5. **Anything that can pass behind terrain must be depth-tested in the
   shader** — the fx overlay has no depth buffer.

---

## 7. Known open violations

Honest list, so nobody rediscovers them the hard way:

- ~~`mtn relax` ships at 0.55~~ — **resolved 13 Sept 2026.** Nico flew the
  slider to its left end and reported *"the issue is gone!"*, so **0.25 is
  the default**: 0.002% of the island left unmarchable, at +108% march
  iterations in a mountain view and +6% over the sea (the relaxation is keyed
  on the mountain `mass`, so frames without mountains barely pay). 0.55 stays
  at the top of the slider as the v9.5 A/B. `test/test_march.js` now asserts
  the DEFAULT is safe, so trading it back for frame rate is a deliberate edit
  with a number attached.
- **The `peak height` tuning slider can create a world no relaxation setting
  can fix**: at its maximum (800) the island needs relax 0.22 and 7.3% of it
  is unmarchable at the default. The sliders are gameplay-affecting and there
  is no guard on the *live* value, only on the shipped default.
- **`plantEval`'s 550 m LOD switch is hard and per-sample** (R7) — a tree on
  the boundary is drawn half-and-half, and the boundary sweeps as you fly.
- **The plant hit tolerance has no incidence factor and no refine** (R6) — the
  tree silhouette is fattened by `tolRay / 0.45` (1 m at 300 m, 3.3 m at 1 km)
  and its edge jitters ±1 px with the sample phase.

## 8. What these rules cannot fix

They bound the **geometry** error. They do not fix **one ray per pixel**: a
sub-pixel boundary — a coastline, a distant crest, a frond — is decided by a
single sample and will flip as the camera moves, no matter how accurate that
sample is. Measured: 0 of 72 600 pixel rays disagree with a 4000-iteration
reference about land vs water, and the waterline still shimmers. The only
cures there are more samples (the `resolution` knob) or exact geometry with a
depth buffer and mipmaps — which is **v10**.

Do not re-open the coastline wiggle as a marcher bug (RESEARCH §5.4–5.5).

---

## Where the evidence lives

- **docs/RESEARCH.md §5.1–5.5** — the tolerance/incidence fix, the iteration
  budget, the coastline null results.
- **docs/RESEARCH.md §6** — the flutter rigs and the method.
- **§6.7** — the crest clip and the stride floor, with nine dead ends.
- **§6.8** — the render measured at the GPU's exact camera; the chase-camera glide.
- **§6.9** — the from-below straddle, the relaxation, and the cost tables.
- **test/slope_census.js** — every number in §3, re-derivable in 1.2 s.
- **test/test_march.js** — the guard that makes these rules enforceable.
