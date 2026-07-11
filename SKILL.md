---
name: activate
description: >-
  Two-phase workspace bootstrap. First `scan` indexes the whole machine once —
  every global/local skill, rule, guideline, memory, and coordination file — and
  saves it. Then in any later session `activate` reads that saved index and loads
  the full operating stack that applies to the current folder/repo/workspace,
  running the mandatory pre-flight gates. Use when the user runs /activate,
  /activate scan, says "scan my PC for skills/rules", "activate this
  workspace/repo/folder", "onboard me to this project", "load all the
  rules/guidelines/skills here", or "what applies in this directory".
---

# activate (skill-activation)

A two-phase bootstrap so activation is instant and cross-session:

1. **`scan`** — walk the machine ONCE, build a persistent index of every skill,
   rule, guideline, memory and coordination file. Saved to
   `~/.claude/skill-activation/index.json` (+ `index.md` human mirror).
2. **`activate`** — in any later session, read that index and activate the exact
   subset that applies to the current (or a given) folder/repo/workspace, then
   run the mandatory pre-flight gates.

Works in any project on any PC. Degrades cleanly — folders with no `.claude/`,
`CLAUDE.md` or memory still produce a valid (smaller) report. Read-only: the only
writes are the two index files and your own active-tasks registration.

`node.mjs` scripts live in this skill dir. Substitute its absolute path for
`<SKILL>` below (e.g. `~/.claude/skills/skill-activation`).

## Commands

| Verb | Command | What it does |
|------|---------|--------------|
| **scan** | `node "<SKILL>/scan.mjs"` | Index home + `~/.claude` fully. Run once per machine (and after adding skills/rules). |
| scan (roots) | `node "<SKILL>/scan.mjs" --roots d:\code,e:\work` | Index specific project roots instead of home. |
| scan (extra) | `node "<SKILL>/scan.mjs" --add-roots d:\code --depth 8` | Home plus extra roots, deeper walk. |
| **activate** | `node "<SKILL>/activate.mjs" [path]` | Bootstrap the current folder (or `path`) from the saved index. |
| **list** | `node "<SKILL>/activate.mjs" --list` | Show the saved index summary + staleness. |
| refresh | re-run `scan` | Rebuild the index. |

All accept `--json` for machine output. `activate` exits `2` if no index exists
yet — run `scan` first.

## When the user says…

- **"scan my PC" / `/activate scan`** → run `scan.mjs`, report the stats it wrote.
- **`/activate` / "activate this workspace"** → run `activate.mjs` for cwd, then
  follow the activation procedure below.
- **first ever use** → if `activate.mjs` exits 2 (no index), run `scan.mjs` first,
  then `activate.mjs`.

## Activation procedure (after `activate.mjs`)

1. **Check freshness.** If the report flags the index stale (≥7d), offer a rescan.
2. **Load the rule/guideline stack, broad → narrow** — read each file under *RULE
   / GUIDELINE STACK* in printed order so the most specific layer wins:
   global `CLAUDE.md`+`RTK.md` → repo `CLAUDE.md`+`context.md` → app-level files →
   the project `MEMORY.md` (then open any memory whose description is relevant).
3. **Load coordination/state** — every file under *COORDINATION / STATE FILES*,
   especially `.claude/active-tasks.md`, `blockers.md`, `known-bugs.md`.
4. **Run the mandatory pre-flight gates** (below) BEFORE the first edit.
5. **Surface the toolbox** — from the skill inventory, name which skills fit the
   intended work (e.g. `rules-guard`/`visual-review` for UI, `sec-scan` before
   ship, `hq-report` for a PDF, `handoff` at wrap-up).
6. **Confirm active** — short summary: workspace detected, rule layers loaded,
   open active-tasks conflicts, blockers in force, skills queued.

## Mandatory pre-flight gates

Hard gates from the global + repo `CLAUDE.md`. Activation is not complete until
each holds:

- **Active-tasks registration** — before the first file edit, read
  `.claude/active-tasks.md` and register under `## Active` (UTC+7 id
  `dd-mm-yyyy_HH-MM`, goal, `claimed` paths). Overlapping claim = STOP + surface.
- **Infisical only** — never write secrets to Vercel/Railway.
- **Merge only when green** — never merge a PR on a red/pending check.
- **UI standing rules** — no native date/time pickers, no CDN fonts, no URL image
  inputs, Ctrl/Cmd/Shift/middle-click preserved, branded `ConfirmDialog` not
  native `confirm()`, no horizontal scroll, dark-glass modal branding. Run
  `rules-guard` to check mechanically.
- **Changelog** — user-visible change updates `<app>/docs/changelog.md` +
  regenerates `changelog.pdf`.
- **Timezone** — `dd-mm-yyyy | HH:MM UTC+7`.
- **No-broken-window** — fix any standing-rule violation in a file you touch.

## Notes

- Built-in harness skills (`code-review`, `verify`, `run`, `handoff`,
  `hq-report`, `deep-research`, `dataviz`, …) are always reachable via the Skill
  tool regardless of folder; the index also captures plugin skills (`caveman:*`,
  marketplace) it finds under `~/.claude/plugins`.
- The gate list mirrors this machine's Atlas Labs rule set; on other machines it
  degrades to whatever `CLAUDE.md` layers the scan actually found.
