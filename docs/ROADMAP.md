# Roadmap (drafted after the terrain/shimmer research session)

## ⚠ PARTLY UNBLOCKED — read this first (updated 9 Sept 2026)

**The barrel AC adapter is still dead. Nico is on USB-C PD.** The graphics
work is no longer fully blocked — the RTX does leave its idle P-state on
USB-C — but it is not running at full power either.

| power source | pstate | SM clock | draw |
|---|---|---|---|
| battery (8 Sept) | P8, 146/150 samples | 210 MHz | 5.5 W |
| **USB-C PD (now)** | P4–P5 | 855–1710 MHz | 13–20 W |
| 240 W barrel (spec) | P0 | up to 2040 MHz | up to 150 W |

**The finding that matters:** `power.default_limit` reads **80 W** against a
`power.max_limit` of **150 W**, and one sample caught the card at exactly
1455 MHz — the documented boost ceiling for a 4090 Laptop at 80 W TGP. So the
GPU is on the 80 W profile.

⚠️ **Not yet separated: is that cap the USB-C supply, or G-Helper?**
`performance_mode` is now 0 (Balanced); it was 2 (Silent, limits 80) during
the v9.2 hunt. **Try Turbo before concluding a new adapter is needed.** That
is the single cheapest experiment left and nobody has run it.

Nico's verdict 9 Sept 2026, after the adapter research: *"it looks like I need
a new adapter."* The failure pattern (dies, revives after being left unplugged,
dies again after a reboot) is a latched protection circuit, not a dead brick,
and is reported on other ROG units — full write-up and sources in
**docs/RESEARCH.md §4**, which also covers iGPU vs dGPU and the Chrome flag.

**Chrome on the dGPU** (needs its own `--user-data-dir`, or a running Chrome
swallows the flag):

PowerShell 5.1 is the only shell on this machine, and this command was wrong
for it in two ways until 13 Sept 2026: `%TEMP%` is cmd.exe syntax that
expands to nothing in PowerShell, and the path separator had been written as
a literal FORM FEED byte (a `\f` that something interpreted), which broke it in
every shell:

```sh
chrome.exe --user-data-dir=$env:TEMP\ff-rtx-profile --force-high-performance-gpu http://127.0.0.1:8734/index.html
```

**Still untested from v9.2:** the periodic hiccup. It appeared ONLY on the RTX
(never the iGPU), on both A1 and v9.1, and went away after a reboot —
consistent with a driver clock/power-state transition, not the game. Frame-time
sampling found zero spikes above 1.8x median, and the only teleport in world
state was jul's ring recycler (~4 km on a ~4 s cadence, `js/rings.js`,
untouched by any A-commit). Re-test on real AC.

---

## ▶ NEXT SESSION — START HERE (work queue, in order)

**Version is v9.8; the branch is still named `v9.5`.** (The branch name lags
the version on purpose — PR #3's head branch on origin is named `v9.4`. See
the push note at the bottom.) v9.7 is the last version of the pure
raymarcher: **v10 is a renderer change**, and it was Nico's call after the
marcher hunt proved the residual flutter is not a bug.

📐 **Read `docs/MARCHING.md` before touching terrain, the march, or any SDF.**
Six bugs over six weeks were one mechanism; that file is the law, eight rules
and two checklists, and it is what stops the seventh.

0. **Run the gates.** `node test/run_tests.js` must print "all suites passed"
   (**92 assertions, 15 files**; three skip without `npm install`, and one
   more without python). Then
   `python serve.py 8734`, press START, fly it once. Budget **~50 s for the
   driver compile** since the debug split — that is normal here, not a hang.
1. If you touch anything in `test/`, also run **`node test/mutants.js`**
   (slow, opt-in, **57 mutants as of v9.8**). A green suite is not
   evidence. This is not a formality: the newest suite, `test_panels.js`,
   passed all six assertions on its first run and the battery caught its
   headline mutant ESCAPING. Read that file's header before trusting any test
   you did not personally break.

---

### ✅ 1b. The camera-keyed glitches — CLOSED 13 Sept 2026, and written up

Six bugs, one mechanism, now documented once instead of re-derived: **
`docs/MARCHING.md`**. The last two fixes, both in v9.6:

- **From above / level**, a ray grazes a crest tip and the *minimum stride*
  decides whether the centimetre clip is caught. `march stride` 0.0009 →
  0.0002; hard-ray flips 84 → 19 (RESEARCH §6.7, nine dead ends listed).
- **From below**, the ray crosses the crest *body* — 4–10 m thick along the
  ray — with a step of up to 9.7 m, because the step is `relax × the vertical
  gap` and the safe factor is `cos(slope)`: 0.55 covers only 56.6° and could
  not march 2.589% of this island. `mtn relax`, keyed on the mountain `mass`,
  **defaults to 0.30** (0.017% unmarchable, +76% iterations in a mountain
  view, +5% over the sea). Nico, flying it: *"the issue is gone!"*
  RESEARCH §6.8–6.9.

Also shipped for the hunt and worth keeping: Debug `obs camera`
(`snap`/`freeze` — a camera that does not glide, which is how the camera was
finally cleared as the cause), `invasion` and `rings` (hide everything that
moves by itself), `test/slope_census.js` (re-derives the whole census in
1.2 s) and `test/test_march.js` (fails if a terrain edit outruns the
relaxation slider).

---

### ✅ 1b-bis. v9.8 — light, shadow and nightfall (15 Sept 2026)

Three of Nico's requests, all shipped, all covered by tests. The measurements
are in **docs/HISTORY.md → v9.8**; the short version:

- **Harvest rings no longer draw through mountains.** Two independent causes:
  the allocator was spending its ten pop slots on rings that had not STARTED
  yet (a blast staggers them over 1.1 s against a 0.7 s life), and the probe's
  own march had a constant 10 m stride floor capping its reach at ~480 m. Pops
  and impacts now share one 21-slot pool, round robin.
- **The mothership occludes the overlay; harvesters and the relay deliberately
  do not** — the pops under a harvester are what tells you the sweep works.
- **The alien fleet casts shadows** (`alienShadow`: an analytic chord through
  the bounding volume, no hull march, melting wrecks stop casting).
- **The sun sets.** `nightAmount` continues where `duskAmount` saturates,
  `SUN_EL_MIN = -0.30` lets the drag reach full night, and the glow-in-the-dark
  flora becomes the light source.

⚠️ **Not measured: the compile and frame cost of `alienShadow`.** It is
analytic and inlined at three shading paths, so it should be cheap, but no
controlled before/after was taken, and compiles here vary by more than most
effects being measured. Take both sides in one sitting if it matters.

⚠️ **Nico has not flown any of it.** Night was confirmed on screen and the
mothership shadow by a GPU A/B (38.7% of the frame brightens when the hull is
removed, ground rows only, zero in the sky). The ring-occlusion fix is covered
by unit test and source invariant but was NOT seen in flight — staging a
harvest behind a ridge needs a pilot. **Ask him for that first.**

### ▶ 1c. The TREES — the same law, two named fixes (START HERE)

Nico, 13 Sept: *"certain trees... a tree that should have a fixed contour,
even with parallax, should not get a different form, but some do."* Both
causes are known, both are rule violations from MARCHING.md §7, and neither
needs an investigation — only the work and a GPU cost measurement.

1. **The 550 m frond→envelope switch is hard AND keyed per SAMPLE** (R7).
   `plantEval` picks the detailed silhouette or the smooth envelope from the
   *sample's* march distance, so one tree straddling 550 m is drawn half
   detailed and half blob, and that boundary sweeps through it as you fly.
   Fix: key the switch on the TREE CELL's distance (so a tree is never split)
   and cross-fade it over a band instead of snapping — and pick the distance
   from the pixel footprint, the way A1 fades terrain octaves, rather than a
   fixed 550 m. ⚠️ Measure the GPU cost first: fronds beyond 550 m is exactly
   the work the LOD exists to avoid.
2. **The plant hit tolerance has no incidence factor and no refine** (R6).
   `dP < tolRay` with the 0.45 Lipschitz margin fattens every tree by
   `tolRay/0.45` — 1 m at 300 m, 3.3 m at 1 km — and its edge jitters ±1 px
   with the sample phase. The terrain march already solves both
   (`tolRay * max(abs(rd.y), 0.06)` and the secant refine); the plant branch
   was simply never given them.

Hand Nico a build with `flora range` at its default and ask for the same
one-tap-at-a-time series he flew for the peaks — the tell is identical: a
contour that CYCLES rather than growing monotonically.

### ✅ 1c-bis. The debug build is separate now (14 Sept 2026)

Nico: *"make it that all debug related things (including the panel) are made
fully separate, and they only load when we run the server with a -debug
option... the standalone file should never have the debug options."* Done:
`js/debug.js` holds the knob table, the Debug panel (which builds its own DOM)
and the shader's false-colour channels; `serve.py --debug` serves
`js/dbgflag.js` as true without touching the disk; `build.js` cuts the one
dynamic import so the artifact cannot contain any of it. Measured payoff:
driver compile **~92 s → ~44 s**. Covered by `test_dbg.js`, and `test_build.js`
fails if debug.js ever reaches the single file. Start a debug session with:

```sh
python serve.py 8734 --debug
```

### ▶ 1c-ter. The probe row into its own program — NOT done, ~14 s more

**docs/COMPILE.md §5 is the full write-up**, traps included. In short: the
collision probe row is 15.1% of the inlined program (4 × `terrainShape` +
2 × `plantEval` = 82 k characters) to shade 133 pixels, and moving it to its
own small program takes the compile from ~44 s to ~30 s. ⚠️ It is the
COLLISION AUTHORITY — it must compute from the same GLSL text as the renderer
or collision drifts from what you see — and it trades load time for a second
draw call, so measure the FRAME as well as the compile. Its own session.

### ▶ 1c-quater. Make the loading page honest (small, self-contained)

The six stage names `initRenderer` cycles ('terrain raymarcher', 'alien
flora', 'cumulonimbus', …) are a worded spinner: measured, 'cumulonimbus' and
'ring course' are each worth **under a second** of the ~50 s wait, while the
terrain heightfield — which is never mentioned — is **82%**. **docs/COMPILE.md
§5b** has the four options and the one trap (the extension exposes a boolean,
so any bar smoother than elapsed-vs-expected is invented). The cheap version
is weighting the labels by §2b's shares plus one honest line about what the
wait actually is; it touches `js/renderer.js` and nothing else.

### ▶ 1d. Watch the frame rate at the new default

`mtn relax` 0.30 roughly doubles the march in mountain-heavy frames (+76%).
Nico was at 40–47 fps at 1707×932 before it. If it bites — on his machine or
jul's — 0.35 (0.072% unmarchable, +53%) is the next rung, and `resolution` is
the other lever. Changing the default means editing `test/test_march.js`'s
safety assertion and MARCHING.md §7 with the number it costs.

---
### ▶ 2. v10 — the hybrid: fractal DEFINITION, rasterised GEOMETRY

**This is the next item, and it is a big one.** Nico, 12 Sept 2026, after the
marcher hunt: *"I'd like to orient this game... towards a multiplayer
version"*, and *"By the way I checked No Man's Sky, and wow it's beautiful."*

**Why, in one paragraph.** v9.4 fixed the rings (the hit tolerance) and the
horns (the iteration budget), and then measurement closed the door on the
rest: the coastline's wiggle is real fractal geometry (8.4 m RMS over 20 m,
107 m over 1 km), the land/water boundary is placed correctly (**0 of 72 600
pixel rays** disagree with a 4000-iteration reference), and what remains is
one ray per pixel deciding a sub-pixel boundary every frame. **There is no
marcher fix for that** — see docs/RESEARCH.md §5.4–5.5. A rasterised mesh
gets the three things a marcher cannot have: **MSAA, mipmaps, and a depth
buffer.** The geometry is computed once per *place* instead of once per
*pixel per frame*, so it stops moving when the camera does.

**What stays exactly as it is:** the fractal is still the world. It remains
the *definition* — `terrainShape` keeps generating the heights — so the
download stays a few hundred KB with no asset pipeline, which is the whole
reason this project has no bundler. What changes is *when* it is evaluated:
at chunk-build time, into vertices, instead of per pixel per frame.

**The architectural trap, stated once and plainly.** There are already TWO
representations of the terrain and keeping them identical is load-bearing:
`terrainShapeLOD(p, px)` marches, `terrainShape(p)` is the collision
authority (bit-identical to pre-A1), and `js/terrain.js` mirrors it in fp64.
A mesh is a **THIRD**, and it is the one the player will see and stand on. If
the mesh and `terrainShape` disagree by a metre, the ground you hit stops
being the ground you see — silently, and worst at distance. Decide up front
which is authoritative. The recommendation: **the mesh becomes the authority
for rendering AND collision, generated from `terrainShape`**, and the GPU
probe row (see CLAUDE.md → "The GPU probe row") is retired for terrain rather
than left half-true. That is a bigger edit than the meshing itself.

**Order of work suggested:**
  a. One chunk, one LOD, no stitching: mesh a 1 km tile from `terrainShape`
     on the CPU, draw it with a depth buffer beside the marcher, and compare
     silhouettes at a still camera. This alone answers whether the flutter
     goes away, and it is a day's work rather than a rewrite.
  b. Chunk ring + LOD + seam stitching (skirts are the cheap answer; they
     hide cracks without matching vertex counts).
  c. Move collision onto the mesh, delete the terrain half of the probe row,
     and re-point `test_terrain.js` at whatever becomes authoritative.
  d. **The fleet becomes instanced meshes** — which is ROADMAP **C3** for
     free, because instances have no uniform limit. That unblocks the
     spreading invasion (parked below) at close to zero renderer cost.
  e. Keep the marcher for the things it is *better* at: clouds, water, and
     the mandelbulb relay are volumetric or trivially analytic.

**Traps that will bite, all already known:**
- **The TUNE sliders change the terrain.** `terrain.js` reads live TUNE
  values, so moving `oceanSlope` or `mountAmp` changes the world — with a
  mesh that means invalidating and re-meshing every chunk. Cheap to forget,
  expensive to discover.
- **Shader compile is 200–240 s** for the marcher. Raster shaders are small,
  so this gets dramatically better — but do not benchmark a raster path
  against a marcher figure taken in a different sitting (RESEARCH.md §5.6).
- `DPR` is capped at 1.0 and the adaptive scaler resizes the buffer, which
  changes `uPixScale`. Peg the scaler before any A/B.
- **Do not rebuild the served tree while Nico is flying it.** Use a
  `git worktree` on another port. This cost a false result in v9.4.

### ▶ 3. Multiplayer — the v10 KICKOFF AGENDA (do not answer these early)

⚠️ **These are deliberately unanswered.** Nico's call, 12 Sept 2026:
*"keep the multiplayer questions for v10, add these questions for when we
start working on that."* So do NOT chase answers before v10 starts — but do
**put this list in front of him in the FIRST message of the v10 session**,
because every one of these is cheap to decide now and very expensive to
retrofit. They are recorded here, in his own framing of the goal: *"I'd like
to orient this game... towards a multiplayer version."*

Work down the list with him before writing renderer code, because the
answers change what v10 builds:

- **Determinism and seeding.** The world is a pure function today, which is
  the best possible starting point: two clients running the same code over
  the same coordinates get the same island with nothing transmitted. But
  `terrainShape` is fp32 in GLSL and fp64 in `terrain.js`, and fp32 is not
  bit-portable across GPU vendors. If clients ever compare terrain answers,
  the **fp64 CPU mirror has to be the authority** and the GPU may only be
  allowed to draw, never to decide. Also: the island has no seed at all right
  now — `MB_CENTER`/`MB_SCALE` are constants. One world or many?
- **Server-authoritative TUNE.** The tuning panels are gameplay-affecting by
  design ("the tune sliders ARE gameplay" in CLAUDE.md). Two players with
  different `oceanSlope` are in different worlds, and the Debug panel can
  change `resolution` and detail fade. In multiplayer the world knobs must
  come from the host and the client keeps only the cosmetic ones. Deciding
  which knob is which is a 20-knob triage, best done while the reasons are
  still fresh.
- **What IS the second player?** Never discussed, and it sets everything
  else. Co-op against the same invasion (shared fleet state, so the
  invasion economy in `aliens.js` needs one owner); competitive on the ring
  course (`rings.js` spawns are already terrain-seeded, so both players can
  derive the same course with nothing transmitted); or just ghosts — seeing
  each other fly with no shared stakes, which is the cheapest by a wide
  margin and needs no authority decision at all.
- **Who owns the invasion?** Today `aliens.js` runs the whole economy
  locally off a local clock. Two clients running it independently will
  diverge within seconds (harvester spawns, relay growth, blast timing), so
  either one client is the host for fleet state or it moves to a server.
  This is the single biggest gameplay-code question and it is independent of
  the renderer — note that all 19 alien assertions already run headlessly,
  so whatever is decided is testable without a browser.
- **What crosses the wire, and how often?** Craft pose is ~7 floats; the
  fleet is ~10 objects; the terrain is zero bytes because it is a function.
  That is a tiny budget by multiplayer standards and it is worth knowing
  before picking a transport — ask Nico whether he wants peer-to-peer
  (WebRTC, no hosting) or a small server (WebSocket, needs somewhere to
  run), because the project currently has no backend at all and
  "no npm, no framework, no bundler" is a stated value.
- **Does collision stay client-side?** The GPU probe row is the collision
  authority today and it is bit-exact with what that client renders — which
  is exactly what an authoritative server cannot trust. Related to the v10
  question of what becomes authoritative once terrain is a mesh (item 2).

### ▶ 4. Coverage still missing (carried over, still true)

`terrain.js`, the panels and the module graph now have tests. These have no
behavioural coverage at all: `flight.js`, `rings.js`, `weapons.js`,
`spores.js`, `fx.js`, `math.js`.
  * **`rings.js` first.** jul's 4 s delayed recycler is the only thing in the
    world that teleports (a ring moves ~4 km on a ~4 s cadence) and it was
    never cleared as a suspect in the v9.2 hiccup hunt. It is also jul's
    code, so a test there is the most useful thing to hand back in a volley.
  * `flight.js` next: the auto-level clamp (~49°), the SPACE free-flight path
    and the camera terrain clamp all have documented bug history in
    docs/HISTORY.md and none of it is pinned.
  * Use `test/harness.js` (stub the imports) and run `node test/mutants.js`
    afterwards — a new assertion is not trusted until a mutant proves it red.

### 5. B2 / B1 — terrain variety (unchanged, and now cheaper in v10)

**B2 — TerraForge3D biome ports** (mesas + canyons first, MIT attribution for
Jaysmito Mukherjee in the README), then **B1 — multifractal octaves**
(Musgrave-style octave coupling + a slider; mirror it in `terrain.js`, and
`test_terrain.js` will hold you to that). Both get cheaper once terrain is
meshed: a biome that costs ten extra fbm octaves is unaffordable per pixel
per frame and trivial once per chunk.

### 6. ✅ Pushed AND the PR is open (12 Sept 2026) — the ball is with jul

`v9.4` and `main` are both on `origin` (mtnico3000/fractal-flight), and
**PR #3 is open against julaub/fractal-flight:main** —
https://github.com/julaub/fractal-flight/pull/3 — 20 commits, 44 files,
+11 708/−121, reported mergeable/clean. First volley since v7.0.

Notes for whoever picks this up: there is still **no `julaub` remote**
configured locally (the comparison was done with a one-off
`git fetch <url> main:refs/remotes/julaub/main`), and **no `gh` CLI on this
machine** — the PR was opened through the REST API using the Git Credential
Manager token that `git push` already uses. julaub/main had 2 commits we did
not have; both are jul's merge commits for PR #1 and #2 and the content diff
from the merge base is empty, so nothing of his was at risk.

⚠️ **PR #3's head is the branch NAME `v9.4` on origin, and GitHub cannot
re-point a PR's head.** Local work moved to `v9.5` on 12 Sept 2026. Until
jul merges, every push must feed BOTH refs, or the PR goes stale while
`origin/v9.5` moves on:

```sh
git push origin v9.5 v9.5:v9.4 main
```

### ✅ Landed 12 Sept 2026, evening — the third marcher pass (v9.5)

- **The beach/ridge flutter was NOT irreducible, and Nico's hypothesis was
  right**: budget exhaustion in `marchTerrain` returned −1 and was drawn as
  WATER over the beach — the hull horns on the other march. Now 384
  iterations, exhaustion returns the surface, the minimum stride is a Debug
  knob (0.9‰, was 1.8‰) and a secant refine puts the hit on the surface.
  Sea scene: holes 49 → 0, frame-to-frame flips 15 → 4 with the reference
  at 4. **+14% frame time** (after a +65% first version taught us GLSL
  inlining). RESEARCH.md §6; §5.3 is retracted and §5.4 corrected there.
- `tree persp` (world panel, default off): trees no longer shrink with
  distance. `march budget` debug channel: white = a ray hit the cap.
- **Bumped to v9.5 on Nico's call, and flown by him**: *"it's great the coast
  issue is fixed, it worked!"* The mountains are a separate, still-open item
  — his words: *"most are correct and don't change, at some points the ridges
  fluctuate quite wildly in a zone."* See the queue.
- Two things this found and did NOT fix, parked below: the shadow terrain
  and the 550 m tree LOD ring.

### ✅ Landed 12 Sept 2026 (v9.4)

- **The concentric rings are gone.** They were the hit tolerance divided by
  the incidence angle, quantised into shells by the march step — not
  aliasing, which is why they survived supersampling. One `max` cut mean hit
  error **10.5x** and p99 **16x** for +4.6% iterations. RESEARCH.md §5.1.
- **The horns on the rounded hulls are gone.** Tangency was exhausting a
  48-iteration budget on 18.8% of rays that genuinely hit; 384 takes it to
  1.3%. Step relaxation, the fix proposed first, measured WORSE and was
  killed by its own measurement. §5.2.
- **Two suspects cleared by measurement, permanently**: the coastline wiggle
  (real fractal geometry) and the land/water boundary (0 of 72 600 rays
  misclassified). §5.4–5.5. **This is what points at v10.**
- **A4 is a closed null result.** Bisection refinement of the hit point,
  which sat in section A below as a silhouette fix, was implemented and
  measured at **1.0x** — exactly no improvement. Do not build it.
- Water LOD (the sparkle is a Nyquist crossing; shipped on at 0.80 — *"very
  cool... superb"*), energy beams moved into the shader so they are
  depth-tested, a blue fleet, hull-conforming bomb rings, rounded hull
  corners at 45% with matching collision, the relay 5x bigger growing to
  ~35x and deflating over 2 s, a ~116 s melt tail, and the **HARVESTERS**
  counter with **INVADERS DEFEATED** in its place.
- **The Debug panel shipped** (six false-colour channels in a `uDebugMask`
  bitmask, plus resolution / detail fade / ray tol / water LOD). Built as a
  diagnostic, kept on Nico's call: *"we're going to keep the whole debug
  panel, it's fun to tweak."* It is how the rings were localised.
- Suite **72 assertions / 11 files**, battery **42/42**. New:
  `test/test_panels.js` (the panels as a real DOM).

### Open questions for Nico

- **Turbo vs a new adapter — MEASURED 12 Sept 2026, and the question was
  wrong.** Nico rebooted into G-Helper Turbo (`performance_mode: 1`) and
  Ultimate MUX (`gpu_mode: 2`). Result: the **GPU-selection problem is
  solved** — the display is wired to the dGPU and every browser renders on
  the RTX with no flags — but the card is **still power-starved**: P3–P4,
  975–1290 MHz of 3105, 25–29 W, at 90% load and only 50 °C.
  `nvidia-smi -q -d PERFORMANCE` says `SW Power Cap: Active`, and the
  **enforced limit is 55 W — below the card's own 80 W default.** So it was
  never "80 W: supply or G-Helper?" — 80 W is just the base TGP, and
  something is holding it to 55. G-Helper carries no GPU TGP setting at all
  (only CPU/platform limits, all 80 W) and is already in Turbo. **Nico
  confirmed the machine is on USB-C PD, which closes it: the cap is the
  SUPPLY.** A ~100 W brick covers CPU, chassis and battery charging (15.5 W
  of it right now) before the GPU sees anything. Nothing in software can fix
  that — Turbo and Ultimate both failed to move it — so **the barrel adapter
  remains a hardware purchase blocking any further GPU measurement.** The
  reboot changed which GPU renders, not how much power it may draw.
  docs/RESEARCH.md §4.
- ~~The two multiplayer decisions~~ — **deliberately deferred to the v10
  kickoff** by Nico on 12 Sept 2026, and expanded into an agenda in item 3.
  Do not raise them before then; DO raise all of them at the start of the
  v10 session.
- **Does the shader still LINK on jul's phone?** **242** uniform slots
  against the 224 GLSL ES 3.0 guarantees. Desktop is fine and the count is
  tested, but the mobile half needs a real device. (v10 may retire the
  question entirely.)
- ~~Open the PR to julaub?~~ ✅ **Done — PR #3, opened 12 Sept 2026** on
  Nico's instruction: https://github.com/julaub/fractal-flight/pull/3
  (`julaub:main ← mtnico3000:v9.4`, 20 commits, 44 files, +11 708/−121,
  mergeable/clean). **The ball is with jul.** It is the first volley since
  v7.0 — PR #2 was the last thing merged there — so it carries all of v8,
  v9, C1 and C2 at once.

### ✅ Landed 10 Sept 2026

- **C2's two remaining ports.** Nico approved the dev dependencies (*"ok for
  npm for the remaining C2 ports"*). `npm install` brings
  `@shaderfrog/glsl-parser` and `jsdom`; both suites skip themselves with a
  note when `node_modules` is absent, so a fresh clone still runs the other
  seven. Suite is now **54 assertions across 9 files**, 26/26 mutants caught.
  Beyond ticking the box: the uniform budget stopped being a guess (**238**,
  not the "~260" carried in CLAUDE.md for months), and a misspelled shader
  function call is now a test failure instead of an 80 s driver compile error.
- **Branch renamed `v9.2` → `v9.3`**, and `main` fast-forwarded onto it — it
  had quietly fallen 3 commits behind while the ROADMAP still claimed "main
  points at it".
- **The hull-conforming bomb ring is confirmed good** by Nico, from a
  screenshot at 103 fps / 1036x905 on the dGPU. That closes the last open
  visual question from v9.3.

### Open questions for Nico

- Turbo vs a new adapter (see the top of this file) — one command decides it.
- **Does the shader still LINK on jul's phone?** 238 uniform slots is above
  the 224 that GLSL ES 3.0 guarantees. Desktop is fine and the count is now
  tested, but the mobile half needs a real device — nobody has tried.
- Push to origin / open the PR to julaub? 18 commits are waiting.

### ⏸ Parked, with reasons

- **The shadow terrain is not the drawn terrain (found 12 Sept 2026).**
  `terrainCheapH` is 2 fbm octaves, 13 escape iterations, no domain warp,
  against the drawn 3/26/warped, so shadows are cast by a different island:
  in the grazing over-the-sea view **12.1% of sunlit land is black that would
  be lit against the true surface**. It is static (0.1% frame-to-frame), so
  it is not flutter, which is why it was left. Fix is either a closer cheap
  terrain (26 iterations at least — the coast is where 13 vs 26 diverges) or
  a start-height bias; measure with the shadow rig in RESEARCH §6.2 first.
- **Trees pop between two silhouettes at exactly 550 m** (`plantEval`,
  `mt >= 550.0`: fronds inside, smooth envelope outside) — a ring around the
  player where every tree changes shape as it crosses. Distinct from the
  distance *shrink*, which is now the `tree persp` knob. Blend over 450–650 m
  if it is ever visible enough to matter.

- **The spreading invasion (specified 12 Sept 2026, deferred to v10).** Nico's
  full design, in his words: *"when the harvesters arrive at 8, a new relay
  appears in another part of the island over another top mountain (not too far
  so as not to have to go through the whole island). The next harvesters to
  drop will then go to that relay, up to eight, then next relay further. Once a
  relay has 8 harvesters this relay is 'complete' and will not get new
  harvesters... Once there are 4 relays the mothership relays are full, and the
  mothership 'duplicates' and floats to another part of the island (same
  altitude), and when it arrives to it's new position it's own relay appears
  somewhere under it, and two first harvesters of that new mothership drop and
  start harvesting for that mothership through it's relay. This way if we let
  the game run alone without bombings, the island should fill itself of
  harvesters and relays and motherships."*

  **Why it is not in v9.4: it does not fit in the uniform budget, by a wide
  margin.** The fleet is singular in the shader -- `uMotherPos` is one vec3,
  `uRelay` one vec4, `uShipPos[6]` six harvesters -- and the budget is already
  **242 of a 260 ceiling** (above the 224 GLSL ES 3.0 guarantees). The design's
  steady state is 8 harvesters x 4 relays = 32 per mothership, then motherships
  multiply:

  | | slots |
  |---|---|
  | 4 motherships | ~4 |
  | 16 relays | ~20 |
  | 128 harvesters | ~144 |
  | **added** | **~168, taking the total to ~410** |

  Even the minimal version (1 mothership, 4 relays, 32 harvesters) needs ~+40,
  i.e. 282 -- over the ceiling. **The fleet has to move from uniforms into a
  texture first**, which is ROADMAP C3, and that drags in the `mal.y` material
  encoding (0 mother / 1..6 ships / 7 relay needs a new scheme), a
  `marchAliens` that loops ~150 objects at up to 384 iterations each,
  collision / bombs / probe row / fx occlusion (all assume ONE mothership and
  ONE relay), ~19 alien tests, and a shader compile already over 200 s.

  **In v10 this is nearly free.** Instanced meshes have no uniform limit and no
  per-pixel march per object, and world-anchored chunk LOD is exactly what a
  spreading invasion wants. So the renderer half of the work would be thrown
  away if built now, while the game-logic half carries over untouched -- and
  the logic is fully testable headlessly, which is how all 19 alien assertions
  already run.

  Nico's call, 12 Sept 2026: *"we drop for not the full invasion with multiple
  relays and motherships. Document it for later, but let's drop that complexity
  now."*

  What v9.4 DOES ship from this: the live **HARVESTERS** counter beside RINGS
  and SPORES, and **INVADERS DEFEATED** replacing it once the whole invasion is
  gone. The banner is gated on harvesters AND relay AND mothership all being
  dead, not just the harvesters -- bomb every harvester while the mothership
  still floats and it simply builds more, so victory then would be a lie.

- **GPU / adapter warning on the start page.** Nico asked for a "GPU
  selector"; a selector is **not buildable** — no web API enumerates or picks
  an adapter (WebGL's `powerPreference` is a hint, WebGPU refuses enumeration
  for fingerprinting reasons). What IS buildable and is worth more: read
  `WEBGL_debug_renderer_info`, NAME the adapter on the start page, and warn
  when it looks integrated/software, with the platform fix. Nico's call
  8 Sept 2026: *"let's drop 2 for now"*. Caveats when it is picked up:
  Firefox restricts the extension under `resistFingerprinting`, and it cannot
  detect the battery/P8 case at all (the adapter name is identical at 210 MHz
  and 3105 MHz) — only frame timing can.
- **A2–A6.** Built, measured, dropped from the mainline; they live on branch
  `v9.1`. The measurements are in docs/RESEARCH.md — **read that table before
  rebuilding any of them.** A4 −28% far edges for −6% throughput; A2+A3
  shore −71% / fireflies −83% for −2% (Nico: *"the beach fix was ok but had
  some other aliasing issues which made me prefer the older version"*); A5 a
  niche hover tool; A6 TAA measured **worse on both axes** (−31% detail,
  +30% temporal) and needs motion vectors to be viable.
- **`test_docs.js` CRLF fix is only on this branch.** If `v9.1` is ever
  checked out fresh its doc guard will go red for that reason alone.

### Reference materials

- `docs/papers/paperftfractals.pdf` — van Lawick van Pabst & Jense,
  multifractal terrain (TNO). Feeds B1: α = singularity/peak density,
  C1 = sparseness, H = smoothing; their FFT pipeline is offline-only, use
  the Musgrave octave-coupling equivalent in-shader.
- `docs/papers/On_escape_criterion_of_an_orbit_with_s-convexity_a.pdf` —
  Alam et al., PLOS ONE 2025. Feeds B3: escape criteria for
  cos(u^m)+αu+β with s-convex orbits; use as 2D continent/flora MASKS only
  (no distance estimator exists → not raymarchable); s and α are morph
  sliders.
- TerraForge3D is NOT vendored here — clone when starting B2:
  `git clone --depth 1 -b gen3 https://github.com/Jaysmito101/TerraForge3D`
  → `Binaries/Data/shaders/generation/base_shape/*/shape.glsl` (mesas and
  canyons are the best starting ports; ~30 lines each, fbm+mask style,
  compatible with our analytic terrainShape). MIT license — keep the
  copyright notice (Jaysmito Mukherjee) in README when porting code. Their
  erosion/denoise filters are heightmap raster passes — NOT portable to
  our analytic terrain (only relevant if we ever do the B4 hybrid baking).

---

Ordered by value-per-effort within each theme. Effort: S (<half day),
M (a day-ish), L (multi-day / architectural).

## A. Image stability — kill the shimmer

The world sparkles and silhouettes crawl because we shoot ONE ray per pixel
at a surface with detail far beyond Nyquist, with no AA of any kind
(uJitter is locked to 0), a hit tolerance that grows with distance
(`0.01 + 0.0015·t`), binary material decisions at the shoreline, and a
`pow(…, 260)` sun glint (specular fireflies).

⚠️ **Read this section against docs/RESEARCH.md §5 before acting on it.**
Two of its five named causes are now fixed (the growing hit tolerance,
the 260 glint), one is a measured null result (item 4), and the remaining
one-ray-per-pixel problem was measured to be **irreducible** in this
renderer — which is why the queue at the top of this file now leads with
v10 rather than with more of this ladder. Fix ladder as originally
drafted:

1. **Footprint-aware detail fade (S/M, do first).** Scale fbm octave count /
   amplitude and the color-detail frequencies (rock strata, alienFlora
   undergrowth, snow masks) by the pixel's ground footprint (`uPixScale·t`).
   Analytic mipmapping: removes most ground sparkle AND reduces GPU cost.
   Mirror-sensitive: terrainShape only (terrain.js mirror keeps full detail —
   gameplay queries want the true surface).
2. ✅ **Soften the razors (S) — SHIPPED 12 Sept 2026** as the `water LOD`
   knob (on at 0.80). The sparkle is a Nyquist crossing between ripple
   wavelength and pixel footprint, so the ripple normal AND the specular
   exponent (260 → 30) fade by FOOTPRINT, not by distance. RESEARCH.md
   §5.7. Nico: *"the water LOD does fix the sparkling water, very cool...
   superb."*
3. **Shoreline band (S).** Blend water/terrain shading over a small
   `|h − WATER_LEVEL|` band scaled by footprint instead of the binary
   mat 1/2 pick.
4. ~~**Silhouette stabilization (S).**~~ ❌ **CLOSED, 12 Sept 2026 — half
   shipped, half a measured null result.** The "slower-growing hit
   tolerance" half was the real bug and is fixed: the tolerance is now
   divided by the incidence angle, which removed the concentric rings and
   cut mean hit error 10.5x (RESEARCH.md §5.1). The "few bisection steps at
   hit refine" half was implemented and measured at **1.0x — exactly no
   improvement**, because the error was in where the march stops caring,
   not in the interpolation once it stops. **Do not rebuild it.**
5. **Still-camera accumulation (M).** When view+craft are ~static (esp.
   OBSERVATION mode), jitter uJitter and average frames in an FBO —
   converges to a perfectly antialiased frame in ~0.5 s; falls back to
   current behavior in motion. Pairs with: lock renderScale while in O mode.
6. **Full TAA with reprojection (L, the gold standard).** Needs history
   texture + per-pixel depth output (we march anyway — write t to a second
   attachment), Halton uJitter, neighborhood clamp. Watch ghosting on the
   craft/rings/bolts.

## B. Terrain variety

1. **Multifractal octave coupling (S).** Weight each fbm octave by the
   signal accumulated so far (Musgrave-style) instead of fixed 0.5 gain —
   valleys smooth, ridges jagged, one multiply per octave. Add a slider
   (the paper's α-analog). Mirror in terrain.js.
2. **TerraForge3D biome ports (M).** gen3 `generation/base_shape/*` is MIT
   (attribution required): mesas, canyons, karst, dunes, terraces, craters,
   volcano — each ~30 lines of fbm+mask math directly compatible with our
   analytic terrainShape. Add a low-frequency biome selector field blending
   1-2 shapes per region into the smax composition; gate evaluation by
   selector so each point pays only its local biome. Mirror in terrain.js.
3. **cos-type world masks (M).** From the s-convexity escape-criterion
   paper: iterate cos(u^m)+αu+β as the CONTINENT MASK (the role z²+c plays
   today) → alien coastlines; expose s/α as morph sliders. 2D masks only —
   no distance estimator exists for raymarching these in 3D. Same trick can
   re-skin alienFlora.
4. **Hybrid baking (L, only if needed).** Tile the macro terrain into a
   heightmap texture (keep analytic micro-detail on top): one fetch replaces
   two mandelDE evals (net speedup) and unlocks raster erosion filters à la
   TerraForge — at the cost of the pure-analytic architecture.

## C. Engineering

1. **Single-file build script (S, FIRST TASK in Claude Code).** Generate
   `fractal-flight-single.html` from the modules (inline css + concat js in
   dependency order, strip import/export, rename the few divergent
   identifiers). Ends the dual-build maintenance that caused repeated
   patch-drift bugs.
2. **Port the Node test harnesses (S/M)** — ✅ **C2 COMPLETE.** `test/` runs
   **72 assertions across 11 files** plus `check_module_refs.py`, and
   `test/mutants.js` verifies the tests themselves (**42/42**). Three suites
   need `npm install` (`test_glsl.js`, `test_smoke.js`, `test_panels.js`)
   and skip themselves with a note without it, so a bare clone still runs
   the other seven. Flight modes and rings still have no coverage — see
   item 4 in the queue.
3. **Uniform budget check (S).** ✅ now MEASURED, not estimated: **246 vec4
   slots** as of v9.8 (242 at v9.4, 238 before the energy beams moved into the
   shader), counted from the parsed GLSL by `test_glsl.js`, which fails above
   a 260 ceiling. ⚠️ Read the number off the test, not off this page — it has
   drifted three times already. The old "~260" was a guess. Still **above the 224 that GLSL
   ES 3.0 guarantees**, so the shader may fail to LINK on jul's phone while
   every desktop is fine — that half is untested and needs a real device.
   Biggest consumers: `uBlastCell[64]`=64, `uFxPos[48]`=48, `uRingMats[8]`=24,
   `uCloudPos[16]`=16. Pack those into a texture before trimming elsewhere.
4. **C3 — move the fleet from uniforms into a texture (M).** Referenced by
   name throughout this file and never actually listed here. It is the
   precondition for the spreading invasion (parked below), which needs
   ~+168 slots against a 260 ceiling. **In v10 it is nearly free** —
   instanced meshes have no uniform limit — so do NOT build it against the
   marcher unless v10 is abandoned.
5. **GitHub Pages deploy (S).** Playable URL for the ping-pong, no local
   server.

## D. Parking lot (discussed, not committed)

- Mandelbulb/Mandelbox flyable landmark variants (negative-scale organic
  family is the visual gold: boxScale ≈ −1.5…−2.8).
- Alien counterplay escalation (harvesters reacting to being bombed).
- ~~Multiplayer-ish: pilot-name livery already persists; ghosts someday?~~
  → **promoted.** Nico asked for it directly on 12 Sept 2026 and it is now
  item 3 in the queue at the top, with the two decisions it needs first.
