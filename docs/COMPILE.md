# Shader compile time — where the load goes, and what it is worth

*Measured 14 Sept 2026, after Nico asked: "what made the compile time at
loading of the game... did we introduce useless things while chasing the
fluctuating terrain/beach problem, and is there things we could remove?"*

Short answer: **none of the terrain-fluctuation fixes cost compile time.** The
iteration caps, the stride floor, the `mtn relax` keying, the secant refine and
every A/B knob measure at zero. What cost half the compile was **two
diagnostic channels** added to chase the problem — and they are now in a
separate module that ships nowhere near the game.

---

## 1. Method, and why the method matters here

`initRenderer` compiles + links one fragment program and polls
`COMPLETION_STATUS_KHR`. Timing it needs two precautions:

1. **Defeat the driver's shader cache.** Recompiling an identical source
   returns in milliseconds. Every variant below carries a unique trailing
   comment, so each is a genuine cold compile.
2. **Establish the noise floor before believing anything.** This matters more
   than any single reading — see the table.

| the SAME unmodified shader, five cold compiles |
|---|
| 128.4 s · 140.7 s · **93.2 s · 91.2 s · 91.8 s** |

The first two compiles of a session are slow and it settles at **~92 s**. So
the honest baseline is 92 s with a ±25% early-session excursion, and *any
effect smaller than ~25% is unmeasurable in a single reading*. CLAUDE.md
already carried that warning ("one reading is not a measurement, and shader
compiles are the worst case"); this is what it looks like in numbers.

⚠️ The 200–240 s that CLAUDE.md and ROADMAP quote is a wall-clock figure from
START, on a machine in a different power state. Compile+link alone, today,
settles at ~92 s before this change.

## 2. The measurements

Interleaved with baselines so drift cannot masquerade as an effect.

| variant | compile+link | verdict |
|---|---|---|
| **shipped v9.6 (settled baseline)** | **~92 s** | — |
| terrain march 384 → 48 iterations | 92.7 s | **no effect** |
| mandelDE 26 → 8 iterations | 92.0 s | **no effect** |
| softShadow 24 → 6 (6 call sites) | 92.1 s | **no effect** |
| two debug channels made cheap | 46.7 · 47.4 s | **−49%** |
| debug block deleted entirely | 46.0 s | −50% |
| + probe-row terrain stubbed | 27.8 · 32.4 s | **−67%** |

The three loop-bound ablations land inside the baseline's own spread. **Loop
trip counts are free**: the compiler keeps a 384-iteration loop with a huge
body rolled, so the cap is a ceiling on work, not on code size. This confirms
the earlier A/B recorded in CLAUDE.md rather than contradicting it.

## 2b. What the ~50 s is actually made of, subsystem by subsystem

Measured 14 Sept 2026 on the shipped v9.6 shader (debug already split out).
Each row replaces ONE function's body with a trivial `return`, keeping its
signature so every call site survives — that removes the subsystem's code and
everything it inlines, and nothing else. Four baselines interleaved:
**49.8 · 50.0 · 53.3 · 48.5 s**, mean **50.4 s**, spread 4.8 s — so anything
under ~5 s in the last column is noise, and is marked as such.

| what is being built | stub | compile | it costs | share |
|---|---|---|---|---|
| **the terrain heightfield** — `terrainShapeLOD`: 2 Mandelbrot distance estimates, a domain-warped 5-octave ridged fbm, 3 fbm fields, lakes. The world itself. | `0.0` | **9.1 s** | **41.3 s** | **82%** |
| **the surface normal** — `terrainNormal`, which evaluates the heightfield 4× per shaded pixel (hL/hR/hD/hU) for lighting | flat up | 32.8 s | 17.6 s | 35% |
| **the shadow heightfield** — `terrainCheapH`, the deliberately coarser 2-octave/13-iteration copy the sun rays march | `0.0` | 37.6 s | 12.8 s | 25% |
| **the terrain march** — `marchTerrain`: the 384-step sphere trace, the tolerance stop and the secant refine | miss | 39.6 s | 10.8 s | 21% |
| **sun shadows** — `softShadow`, 24 steps, at 6 call sites | lit | 42.1 s | 8.3 s | 16% |
| **trees** — `plantEval`: the tree-fern SDF with Julia-carved fronds | far away | 45.7 s | 4.7 s | 9% |
| **the craft** — `sdCraft`, the player's aircraft SDF | far away | 47.0 s | 3.4 s | 7% |
| **terrain shading** — `terrainColor`: altitude bands, slope, snow, undergrowth | grey | 47.6 s | 2.8 s | 6% |
| the alien fleet — `marchAliens`, mandelbox hulls + the relay bulb | miss | 49.4 s | 1.0 s | *noise* |
| jul's ring course — `marchRings` | miss | 49.7 s | 0.7 s | *noise* |
| clouds — `cloudLayer`, 16-step volumetric | nothing | 51.5 s | −1.1 s | *noise* |

⚠️ **These do not add up to 100%, and must not be added.** They overlap: the
normal, the shadow field and the march each *contain* terrain evaluations, so
each row is the cost of everything that disappears with it. The one number
that matters is the first: **the terrain heightfield is 82% of the compile.**
Take it out and a shader with the whole fleet, the rings, the clouds, the
craft, the trees and the water still links in 9 s.

The corollary is uncomfortable and useful: **every feature that is not the
terrain is free at compile time.** Adding another alien hull type, another
ring shape or a second cloud layer costs nothing here. Adding one more place
that evaluates the terrain costs ~18 000 characters of inlined code, and the
compiler's time grows faster than linearly in program size.

## 3. Why — GLSL has no function calls

Every call site is a full recursive **copy**. Measured on the v9.6 shader:

| | as written | fully inlined | call sites | total pasted |
|---|---|---|---|---|
| `terrainShapeLOD` | 1 910 ch | **18 371 ch** | 11 | 202 081 ch |
| `terrainShape` (px = 0) | 62 ch | 18 433 ch | 8 | 147 464 ch |
| `terrainNormal` | **585 ch** | **74 069 ch** | 3 | — |
| `main()` | 19 441 ch | **547 227 ch** | 1 | — |

`terrainNormal` is the trap: 585 characters of source that evaluate the
terrain **four times** (hL/hR/hD/hU). The whole fragment source is 71 k
characters and the compiler sees **547 k** — 7.7×.

So the rule is: **extra CALL SITES of the terrain function are expensive;
bigger loop bounds are not.** Keeping the v9.5 secant refine as *phases of the
march loop* rather than a block after it — done for frame time — also kept it
to one call site, which is why it costs nothing here either.

## 4. What the diagnostics cost, and what happened to them

Inside the old `if (dmask > 0)` block, two of seven channels evaluated the
terrain:

| channel | evaluations | inlined |
|---|---|---|
| `terrain height` (bit 8) | 1 × `terrainShape` | 18 433 ch |
| `normal turn` (bit 16) | 2 × `terrainNormal` = **8 terrain evaluations** | 148 138 ch |
| **the block, total** | | **167 993 ch = 30.7% of the program** |

`git log -S` dates both to **`a92da91`, 12 Sept 2026, "v9.4: the marcher…"** —
added to chase this very problem. So Nico's suspicion was right; it just
pointed at the instruments rather than the repairs.

**They were not deleted — they were moved.** `js/debug.js` now holds the knob
table, the Debug panel and that GLSL block, and is reached by one dynamic
`import()` guarded by `DEBUG_BUILD`:

```sh
python serve.py 8734           # the game: no panel, no channels, fast compile
python serve.py 8734 --debug   # everything back
```

`--debug` serves `js/dbgflag.js` as `true` without touching the disk, so git
stays clean whichever way the server was started. `build.js` cuts the dynamic
import, so **the single-file artifact can never contain any of it** —
`test/test_build.js` fails if it ever does.

> 📐 **The rule this earned, for docs/MARCHING.md's list: a diagnostic that
> evaluates the terrain costs exactly as much as one that renders it.
> Instruments are not free in a shader.**

---

## 5. ▶ NOT DONE — the collision probe row, worth another ~17 s

This is option 3 from the report, written down so it is not rediscovered.

**What.** The bottom pixel row (`gl_FragCoord.y < 1.0`, x < 133) is the
collision authority: it answers craft ground/plant, 16 bullets, 64 blast
cells and 3 bomb grounds in the *same fp32 maths that renders*, and main.js
reads it back with one `readPixels` per frame. It costs:

| | |
|---|---|
| written source | 1 710 ch |
| 4 × `terrainShape` | 73 732 ch |
| 2 × `plantEval` | 7 060 ch |
| **inlined total** | **82 502 ch = 15.1% of `main()`** |

Measured: stubbing its terrain calls takes the compile from ~47 s to **~30 s**
on top of the debug split.

**The idea.** Move the probe row into its **own tiny program**, compiled
separately. The render shader loses 15% of its inlined bulk; the probe program
is small and compiles in a moment. Both still compile at load, but two small
programs optimise far faster than one large one — the compiler's cost is
superlinear in program size, which is the whole reason the debug split paid
out 2×.

**Why it is not done yet, and what to watch:**

- ⚠️ **It is the collision authority.** CLAUDE.md: "Collision agrees with
  pixels bit-for-bit." The probe program must compute `terrainShape` from the
  *same GLSL text* as the renderer, or collision silently drifts from what you
  see. Share the source string; do not fork it.
- The probe currently rides the main draw for free. A separate program means a
  second draw call and its own framebuffer/readback plumbing, so measure the
  **frame** cost, not just the compile cost — this trades load time for
  per-frame work, and the frame is the thing players feel.
- `test/test_shader.js` asserts the probe row never calls the LOD variant, and
  `test/test_terrain.js` keeps the fp64 mirror in sync. Both must be repointed
  at wherever the probe source ends up.
- Do it in its own session, with `node test/mutants.js` at the end.

**Expected result:** load ~47 s → ~30 s, i.e. a **~3× total improvement**
against the ~92 s this investigation started from.

---

## 5b. ▶ IDEA — make the loading page tell the truth

**The stage names on the start page are currently fiction.** `initRenderer`
cycles a fixed list every 1300 ms while it polls `COMPLETION_STATUS_KHR`:

```js
const parts = ['terrain raymarcher', 'alien flora', 'cumulonimbus',
               'ring course', 'water & sky', 'collision probe'];
```

There is one opaque driver compile; those six labels are a spinner with words
on it. §2b shows how far from the truth they are — 'cumulonimbus' and 'ring
course' are each worth **under a second** of the ~50 s, while the terrain
heightfield nobody is told about is **82%**. A player watching it learns
nothing, and the one genuinely interesting fact (this is a GPU compiler
translating a procedural world into machine code, not a level loading) is
never said.

Worth doing, in rough order of honesty for effort:

1. **Weight the labels by the real numbers.** Cheapest fix: drive the stage
   text from §2b's shares instead of a flat 1300 ms rotation, so 'the terrain
   heightfield' holds the screen for most of the wait and 'ring course' flicks
   past. Still an estimate, but no longer a misleading one.
2. **Show elapsed against a measured expectation.** The compile is ~50 s on
   this machine and varies ±5% within a session (±25% for the first two of a
   cold session — see §1). A bar driven by `performance.now()` against a
   stored per-machine median, with the number visible, is honest: it says how
   long this usually takes here rather than pretending to know progress.
3. **Say what is actually happening, once.** One line under the bar —
   "your GPU is compiling the world: there is no terrain data to load, every
   mountain is recomputed per pixel per frame" — turns dead time into the most
   interesting thing about the project.
4. **Real progress needs real stages**, which means more than one program —
   §5's probe-row split is the first one. With N programs the loader can
   report N/M genuinely completed. Only worth it if §5 is done anyway.

⚠️ Do not fake a smooth progress bar. `KHR_parallel_shader_compile` exposes
only a boolean (`COMPLETION_STATUS_KHR`), so anything smoother than
"elapsed vs expected" is invented, and a bar that stalls at 90% is worse than
a spinner that never claimed to know.

## 6. Other things measured and NOT worth doing

| idea | why not |
|---|---|
| lower the iteration caps (384 / 26 / 24) | no measurable effect; and they are the fixes |
| strip the A/B knob uniforms (`uRayTol`, `uHitRefine`, `uMarchStride`, `uRelaxMtn`) | 2–6 references each; nothing to win |
| delete the debug channels outright | the split keeps them AND the speed |
| cache the compiled program | WebGL2 exposes no program binary; `KHR_parallel_shader_compile` is already used to keep the start page alive |
