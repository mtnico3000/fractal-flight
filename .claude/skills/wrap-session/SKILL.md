---
name: wrap-session
description: End-of-session routine for fractal-flight. Captures what was decided and learned into CLAUDE.md / HISTORY.md / RESEARCH.md, refreshes the ROADMAP work queue for a fresh session, checks the two builds and the GLSL mirror are in sync, stops dev servers, and commits — so /clear can be run safely. Use when the user says they are wrapping up, ending the session, clearing context, or asks to "get things ready for next time".
---

# Wrap up a fractal-flight session

The next session starts with **zero memory of this conversation**. Everything
that mattered has to be in the repo or it is lost. Work through these steps in
order and report what you actually did — if a step found nothing, say so
rather than inventing activity.

## 1. Prove it still runs

Two gates. First the suite (ROADMAP **C2**, started 6 Sept 2026):

```bash
node test/run_tests.js
```

It must print "all suites passed". Then a real load, because most of this
game is not unit-testable:

```bash
python serve.py 8734
```

Open it, wait out the driver compile, press START. Required: the world draws,
**zero console errors**, and the HUD counts frames. If the session touched
flight, camera, rings or aliens, fly the thing it touched. If it is broken,
**say so plainly** — never wrap up on a silent failure.

⚠️ Use `serve.py`, not `python -m http.server`. The bare module sends no
cache header, so a refresh replays the modules the browser already has and an
edited file looks like it changed nothing. If you must use it, Ctrl+Shift+R.

## 1b. Promote the throwaway checks you wrote

**Standing rule: a check worth writing while building is worth keeping.** Go
back over the Node harnesses, probes and console one-liners used this session
to verify something, and for each decide honestly:

- **Does it assert behaviour that could silently break later?** Then it goes
  in `test/` before the session ends. The established pattern (see CLAUDE.md
  → Testing conventions) evals the REAL module source with stubbed imports:
  strip `^import` lines, strip `export `, then
  `new Function(...stubNames, src + 'return {...}')`. Creating `test/` for the
  first time *is* starting C2 — that is a good thing, not scope creep.
- **Was it a one-off measurement** (grid point counts, a CDN header, "how
  many bombs does it actually take")? Then it is not a test — the *finding*,
  with its numbers, goes in `CLAUDE.md` or `docs/RESEARCH.md`.

Say which checks you promoted and which you deliberately did not, and why.

## 2. Check the two invariants this project keeps breaking

Both are silent failures. Neither shows up as an error.

- **The two builds.** Until ROADMAP C1 ships a build script, the modular repo
  and the single-file `fractal-flight-vX_Y.html` are maintained by hand and
  **every change is supposed to land in both**. If this session changed the
  modular build only, either mirror it or write the divergence down
  explicitly in the ROADMAP queue — an unrecorded divergence is how the dud
  releases (v6_1, v6_2, v8_4, v9_1) happened.
- **The GLSL ↔ terrain.js mirror.** If `terrainShape` in `shaders.js` moved,
  `terrain.js` must move with it numerically — ring, cloud and alien
  placement and the camera clamp all read the JS mirror. Say whether you
  checked, and how.

## 3. Move knowledge into its durable home

| What | Goes in |
|---|---|
| A gotcha, a non-obvious mechanism, exact numbers measured | `CLAUDE.md` |
| What happened this version and **why**, bug post-mortems | `docs/HISTORY.md` |
| Research findings, papers, what was ruled out and why | `docs/RESEARCH.md` |
| Plan status, new backlog items, the work queue | `docs/ROADMAP.md` |
| How a person runs or plays it | `README.md` |

Rules that keep these useful:

- **Write what was measured, not what was assumed.** "273px rows inside a
  244px panel" beats "the panel overflowed".
- **Record dead ends with the reason**, so nobody re-attempts them —
  `theeclipse.app` and the Google Maps COOP saga are the models.
- Note anything found by *running* the code that reasoning missed. Those are
  the most valuable lines in the whole file.
- Keep Nico's and jul's words verbatim when quoting a decision.

## 4. Refresh the ROADMAP queue

`docs/ROADMAP.md` opens with **"▶ NEXT SESSION — START HERE"**, and CLAUDE.md
points every new session at it. That queue *is* this project's handoff —
**do not add a HANDOFF.md.** Rewrite the queue so it describes the present:

- Tick or delete what got done; do not leave a finished item sitting there.
- Put the real next item first, with enough context to start cold: the files
  it touches, decisions already made, the traps.
- Anything the user asked for that is not built yet, in their words.
- Open questions needing an answer before work can proceed.
- If a divergence, a stopped server or a half-finished edit is being left
  behind, say so here.

## 5. Clean up the workspace

- Stop dev servers started for verification (`serve.py` on 8734).
- Delete scratch files that ended up in the repo — this repo has no
  `.gitignore`, so anything you drop in gets offered to `git add`.
- Leave the browser tuning panel values alone; defaults live in `tune.js`.

## 6. Commit — carefully

```bash
git status --short
```

**Read that list before staging.** Files the user changed themselves must go
in their own commit with an honest message, not be swept into yours.

Message says what changed, *why*, what was verified and how, and any
trade-off accepted. End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**Do not push without being asked.** This repo is one half of a two-player
ping-pong — pushing is a volley to jul, and `origin` is Nico's fork
(`mtnico3000/fractal-flight`) while PRs go to `julaub/fractal-flight`. If the
branch is ahead of origin, say so and ask.

## 7. Report

Briefly:

- what is committed and confirmed running,
- whether the two builds are in sync or knowingly diverged,
- what still needs the user's decision,
- the one command to start next time,
- anything you could not finish, stated plainly.
