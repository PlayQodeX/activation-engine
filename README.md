# activation-engine

![activation-engine](assets/banner.png)

> A [Claude Code](https://claude.com/claude-code) skill that loads **the right rules and skills for the folder you're working in** — automatically, before the first edit.

---

## The problem

Claude's instructions are scattered: a global `~/.claude/CLAUDE.md`, a `CLAUDE.md`
per repo, per-app overlays, project memory, coordination files, and skills that
live globally, in plugins, and inside individual repos. Every session, Claude has
to rediscover *which of those actually apply here*.

**activation-engine indexes all of it once, then loads the exact subset that
applies to your current folder — in one command.**

---

## How it works (30 seconds)

Three pieces:

1. **`scan`** — walks your machine **once** and writes an index of every skill,
   rule, guideline, memory file and coordination file it can find.
2. **`activate`** — reads that index and shows the exact rules + skills that apply
   to the folder you're in (global → repo → app, most-specific wins).
3. **`instance`** — optional saved *bundles* of skills + rules you pick yourself,
   each with its own `/activate-<name>` command. Think of them as profiles: a
   `frontend` bundle, a `security-audit` bundle, one per client.

Zero dependencies (pure Node). Read-only, except the index and the command files
it generates. Nothing leaves your machine.

---

## Install

The skill is invoked as `/activate`, so it must live in a folder named `activate`.
Clone it there, then generate its commands:

```bash
git clone https://github.com/PlayQodeX/activation-engine.git ~/.claude/skills/activate
node ~/.claude/skills/activate/instance.mjs sync   # registers the /activate-* commands
```

That's it. (The repo is named `activation-engine`; the installed folder and the
command are `activate` — that's deliberate, not a mistake.)

---

## Quickstart

```bash
/activate-scan      # 1. index your machine (run once, and after adding skills)
/activate           # 2. from inside any repo — see what applies here
/activate-help      # any time — the full command guide
```

Or just talk to Claude: *"scan my PC for skills and rules"*, then later
*"activate this workspace"*.

---

## Commands

Everything is one command — `/activate` — plus a few shortcuts. Type
`/activate-help` for this list inside Claude.

### Everyday

| Command | What it does | When to use |
|---------|--------------|-------------|
| `/activate` | Loads the rules, memory, coordination files and skills that apply to the current folder, then runs the pre-flight checks. | At the start of work in any repo. |
| `/activate-scan` | Rebuilds the machine index. | After install, and whenever you add/remove skills or rules. |
| `/activate-list` | Shows what the last scan found and how old it is. | To check the index is fresh (it warns at 7 days). |
| `/activate-instances` | Lists your saved bundles. | To see what profiles you have. |
| `/activate-help` | The full command guide. | When you forget a command. |

### Instances (saved bundles)

| Command | What it does |
|---------|--------------|
| `/activate create <name> --from-active` | Make a bundle from what the current folder resolves to (fastest way). |
| `/activate create <name> --skills a,b --rules p --guidelines "g1;g2"` | Make a bundle by hand. |
| `/activate add <name> --skills x` · `remove <name> --guidelines "…"` | Edit a bundle. |
| `/activate-<name>` | Activate that bundle (one command per instance). |
| `/activate default <name>` then `/activate --default` | Set a per-repo default, then activate it in one flag. |
| `/activate export <name>` · `import <file>` | Move a bundle between machines. |
| `/activate rename <name> <new>` · `delete <name>` | Manage bundles. |

Any command also accepts `--json` for machine-readable output. `/activate <verb>`
works too (e.g. `/activate list`, `/activate create foo …`).

---

## What `/activate` shows you

Running it in a repo prints, in order:

- **Rule / guideline stack** — global `CLAUDE.md` + `RTK.md` → repo `CLAUDE.md` +
  `context.md` → app-level files → project `MEMORY.md`, sorted broad → narrow so
  the most specific layer wins.
- **Coordination / state files** — `active-tasks.md`, `blockers.md`, `known-bugs.md`.
- **Skills reachable here** — workspace skills for this repo, plus your global and
  plugin skills.

Claude then reads those files and applies them before touching your code.

It **degrades cleanly**: a plain folder with no `CLAUDE.md`, memory or skills still
produces a valid (smaller) result.

---

## Instances in depth

An instance is a small JSON file at
`~/.claude/activation-engine/instances/<slug>.json` with four editable lists:

| Field | Holds | Becomes, at activate time… |
|-------|-------|----------------------------|
| `skills` | skill names | the matching skill — tagged **MISSING** (not on this machine), **⚠untrusted** (a third-party plugin skill), or **✦new** (added since the last scan) |
| `rules` | file paths | that file (e.g. a specific `CLAUDE.md`) |
| `guidelines` | memory names, file paths, or plain text | a memory file, a file, or a literal note |
| `roots` | folders | the scope used to resolve memory + coordination |

Example:

```bash
SKILL=~/.claude/skills/activate

# capture your current setup as a reusable bundle
node $SKILL/instance.mjs create frontend --from-active --purpose "UI work"

# tweak it later
node $SKILL/instance.mjs add    frontend --skills visual-review,rules-guard
node $SKILL/instance.mjs remove frontend --skills handoff

# use it — now and in future sessions
node $SKILL/activate.mjs --instance frontend    # or just: /activate-frontend
```

**Every create/edit/delete regenerates the slash commands** in
`~/.claude/commands/`: one `/activate-<slug>` per instance, pruned when you delete
it. Generated files are marked, so your hand-written commands are never touched.

---

## Where things live

```
~/.claude/skills/activate/          the skill (this repo)
~/.claude/activation-engine/
├── index.json                      the machine index (regenerable — not committed)
├── index.md                        human-readable mirror
└── instances/<slug>.json           your saved bundles
~/.claude/commands/activate-*.md    generated slash commands
```

## Scan options

`scan` indexes `$HOME` + your whole `~/.claude` tree by default.

| Flag | Meaning |
|------|---------|
| `--roots a,b` | Index these project roots **instead of** home. |
| `--add-roots a,b` | Index home **and** these extra roots. |
| `--depth N` | How deep to walk each root (default 6). |
| `--json` | Also print the index as JSON. |

Vendor/build folders (`node_modules`, `.next`, `.git`, `dist`, `venv`, …) are
always skipped.

---

## Design notes — borrowed from Obsidian

The instance model mirrors [Obsidian](https://obsidian.md/)'s vaults / workspaces /
plugin patterns:

- **`--from-active`** ≈ "save current layout as workspace" — snapshot instead of
  hand-listing.
- **`export` / `import`** ≈ syncing vault config — bundles are portable JSON.
- **Trust flags** ≈ Restricted Mode — plugin skills are untrusted by default, and
  anything new since the last scan is flagged.
- **`default` + `--default`** ≈ the workspace quick-switcher.

## Repo layout

```
activation-engine/
├── SKILL.md         the skill definition (invokes as /activate)
├── scan.mjs         build & persist the machine index
├── activate.mjs     bootstrap a folder, an instance, or --help
├── instance.mjs     manage instances + generate slash commands
└── lib/common.mjs   shared, dependency-free helpers
```

## License

No license file yet — treat as all-rights-reserved unless one is added.
