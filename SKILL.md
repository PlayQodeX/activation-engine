---
name: activate
description: >-
  Workspace bootstrap with reusable instances. `scan` indexes the whole machine
  once (skills, rules, guidelines, memory, coordination files); `activate` loads
  the stack for the current folder/repo/workspace and runs the pre-flight gates;
  `instance` builds named, editable bundles of chosen skills/rules/guidelines,
  each with its own `/activate-<name>` command. Use on /activate, /activate scan,
  /activate-<name>, "scan my PC for skills/rules", "activate this workspace",
  "make an instance/profile with these skills and rules", or "add/remove a skill
  from my instance".
---

# activate (activation-engine)

Three moving parts, so activation is instant, cross-session, and tailorable:

1. **`scan`** — walk the machine ONCE, build a persistent index of every skill,
   rule, guideline, memory and coordination file →
   `~/.claude/activation-engine/index.json` (+ `index.md` mirror).
2. **`activate`** — in any later session, read that index and activate the exact
   subset that applies to the current (or a given) folder/repo/workspace, then run
   the mandatory pre-flight gates.
3. **`instance`** — create named, editable **bundles** of chosen skills + rules +
   guidelines for a specific purpose (e.g. `frontend`, `security-audit`). Add or
   remove items any time. Each instance auto-generates its own slash command
   `/activate-<slug>`, so the runnable command set grows/shrinks with the number
   of instances.

Works in any project on any PC. Degrades cleanly — folders with no `.claude/`,
`CLAUDE.md` or memory still produce a valid (smaller) report. Read-only against
everything it scans; the only writes are the index files, the instance files, the
generated command files, and your own active-tasks registration.

Scripts live in this skill dir; substitute its absolute path for `<SKILL>` below
(e.g. `~/.claude/skills/activate`).

## Commands

| Verb | Command | What it does |
|------|---------|--------------|
| **scan** | `node "<SKILL>/scan.mjs"` | Index home + `~/.claude` fully. Run once per machine (and after adding skills/rules). |
| scan (roots) | `node "<SKILL>/scan.mjs" --roots d:\code,e:\work` | Index specific project roots instead of home. |
| scan (extra) | `node "<SKILL>/scan.mjs" --add-roots d:\code --depth 8` | Home plus extra roots, deeper walk. |
| **activate** | `node "<SKILL>/activate.mjs" [path]` | Bootstrap the current folder (or `path`) from the saved index. |
| **activate instance** | `node "<SKILL>/activate.mjs" --instance <name>` | Activate a curated instance bundle. Same as `/activate-<slug>`. |
| **activate default** | `node "<SKILL>/activate.mjs" --default` | Activate the current repo's default instance. |
| **list** | `node "<SKILL>/activate.mjs" --list` | Saved index summary + staleness + new-since-scan. |
| **instance list/show** | `node "<SKILL>/instance.mjs" list [--grep <term>]` · `… show <name>` | List/search instances, inspect one. |
| **instance create** | `node "<SKILL>/instance.mjs" create <name> [--purpose "…"] [--skills a,b] [--rules p1,p2] [--guidelines "g1;g2"] [--roots r]` | New bundle + its `/activate-<slug>` command. |
| **instance from-active** | `node "<SKILL>/instance.mjs" create <name> --from-active [--path <dir>]` | Seed a bundle from the folder's live resolved stack. |
| **instance add/remove** | `node "<SKILL>/instance.mjs" add <name> --skills x` · `… remove <name> --guidelines "…"` | Edit a bundle's contents. |
| **instance rename/delete** | `node "<SKILL>/instance.mjs" rename <name> <new>` · `… delete <name>` | Rename / delete (prunes its command). |
| **instance default** | `node "<SKILL>/instance.mjs" default <name> [--for <path> \| --global]` · `… default --clear` | Set/clear the default instance for a repo or globally. |
| **instance export/import** | `node "<SKILL>/instance.mjs" export <name> [--out f]` · `… import <file> [--name n]` | Share a bundle as portable JSON (home paths → `~`). |
| **instance sync** | `node "<SKILL>/instance.mjs" sync` | Regenerate all `/activate-*` command files + prune orphans. |

All accept `--json`. `activate` exits `2` if no index exists (run `scan` first),
`4` if an instance name is unknown, `5` if no default is set.

## When the user says…

- **"scan my PC" / `/activate scan`** → run `scan.mjs`, report the stats (incl. any
  new-since-last-scan skills to vet).
- **`/activate` / "activate this workspace"** → run `activate.mjs` for cwd, then
  follow the activation procedure below.
- **"make an instance/profile with skills X and rules Y"** → run `instance.mjs
  create <name> …`; for "…like this folder" add `--from-active`. Report the new
  `/activate-<slug>` command.
- **"add/remove <skill|rule|guideline> to/from <instance>"** → run `instance.mjs
  add|remove <name> …`.
- **"make X the default here" / "share/export my instance"** → `instance.mjs
  default …` / `export …` / `import …`.
- **`/activate-<name>` / "activate my <name> instance"** → run `activate.mjs
  --instance <name>`, then follow the activation procedure for its curated stack.
- **first ever use** → if `activate.mjs` exits 2 (no index), run `scan.mjs` first.

## Instances

An instance is a JSON file at `~/.claude/activation-engine/instances/<slug>.json`
holding four editable lists — `skills` (by name), `rules` (file paths),
`guidelines` (memory slugs, file paths, or freeform text), `roots` (folders the
bundle is scoped to) — plus a `purpose`. On any mutation the manager regenerates
`~/.claude/commands/activate-<slug>.md` (a marked, auto-generated slash command)
and prunes commands for deleted instances. `activate --instance <name>` resolves
each curated item against the scan index and **flags missing skills, untrusted
(third-party/plugin) skills, and skills new since the last scan** — so a bundle
stays honest as skills come and go. `--from-active` seeds a bundle from a folder's
live stack; `export`/`import` move bundles between machines; a per-repo (or global)
`default` powers `/activate --default`. Instances are how one machine serves many
purposes: a lean `frontend` bundle, a `security-audit` bundle, a client-specific
bundle — each one command away.

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
