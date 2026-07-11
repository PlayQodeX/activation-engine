# skill-activation

![skill-activation](assets/banner.png)

A two-phase **workspace bootstrap** skill for [Claude Code](https://claude.com/claude-code).

Claude's operating rules, guidelines and tools are scattered across many layers —
a global `~/.claude/CLAUDE.md`, per-repo `CLAUDE.md` / `context.md`, per-app
overlays, project memory, coordination files, and skills that live globally, in
plugins, and inside individual repos. At the start of a session Claude has to
rediscover which of those apply *here*. `skill-activation` makes that one command.

- **`scan`** — walk the machine **once** and persist an index of every skill,
  rule, guideline, memory and coordination file it can find.
- **`activate`** — in any later session, read that saved index and load the exact
  subset that applies to the current folder / repo / workspace, ordered
  broad → narrow, then walk the mandatory pre-flight gates.

Zero dependencies (Node `node:` builtins only). Cross-platform. Read-only except
the index it writes to `~/.claude/skill-activation/`.

## Install

The skill registers as **`activate`** (see `name:` in `SKILL.md`), so it must be
installed into a folder named `activate` — clone with that explicit target:

```bash
git clone git@github.com:PlayQodeX/skill-activation.git \
  ~/.claude/skills/activate
```

(The GitHub repo is named `skill-activation`; the installed skill folder — and the
command you type — is `activate`.) Invoke it with `/activate` and `/activate scan`.

## Usage

```bash
# 1. Once per machine (and whenever you add skills/rules): build the index.
node ~/.claude/skills/skill-activation/scan.mjs

# 2. In any later session, from inside a project: activate it.
node ~/.claude/skills/skill-activation/activate.mjs

# activate a specific folder, inspect the index, or get JSON:
node ~/.claude/skills/skill-activation/activate.mjs d:/code/myapp
node ~/.claude/skills/skill-activation/activate.mjs --list
node ~/.claude/skills/skill-activation/scan.mjs --json
```

Or just talk to Claude: *"scan my PC for skills and rules"*, then later
*"activate this workspace"*.

### scan options

| Flag | Meaning |
|------|---------|
| *(none)* | Index `$HOME` + the whole `~/.claude` tree (skills, plugins, commands, memory). |
| `--roots a,b,c` | Index these project roots **instead of** home. |
| `--add-roots a,b` | Index home **and** these extra roots. |
| `--depth N` | Recursion depth per root (default 6). |
| `--json` | Echo the index JSON to stdout as well. |

Heavy/vendor directories (`node_modules`, `.next`, `.git`, `dist`, `venv`, …) are
always skipped.

## Output

`scan` writes:

- `~/.claude/skill-activation/index.json` — machine index consumed by `activate`.
- `~/.claude/skill-activation/index.md` — human-readable mirror.

`activate` prints the resolved **rule/guideline stack** (global → repo → app →
memory), the **coordination/state files**, and the **skills** reachable from the
target, then Claude runs the pre-flight gates documented in `SKILL.md`.

## How it resolves a workspace

1. `repo root` = the longest indexed git root that contains the target folder.
2. `rule stack` = global layer + every indexed `CLAUDE.md` / `context.md` / `RTK.md`
   whose directory is an ancestor of the target, sorted broad → narrow.
3. `memory` = the project `MEMORY.md` whose slug matches the repo root.
4. `skills` = global + plugin skills, plus workspace skills whose owning project
   contains the target or sits under the repo root.

## Layout

```
skill-activation/
├── SKILL.md         # the skill (invokes as /activate); documents every command
├── scan.mjs         # phase 1 — build & persist the index
├── activate.mjs     # phase 2 — bootstrap a workspace from the index
└── lib/common.mjs   # shared, dependency-free helpers
```

## License

No license file yet — treat as all-rights-reserved unless one is added.
