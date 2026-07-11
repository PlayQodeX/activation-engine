// skill-activation/lib/common.mjs
// Shared, zero-dependency helpers (node: builtins only). Read-only filesystem.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const HOME = os.homedir()
export const GLOBAL_CLAUDE = path.join(HOME, '.claude')
// Where the persisted scan index lives (survives skill re-clone / update).
export const STATE_DIR = path.join(GLOBAL_CLAUDE, 'skill-activation')
export const INDEX_JSON = path.join(STATE_DIR, 'index.json')
export const INDEX_MD = path.join(STATE_DIR, 'index.md')

export const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }
export const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
export const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

// Dirs never worth walking into.
export const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.git', 'coverage', '.turbo',
  '.vercel', 'out', '.cache', '.svelte-kit', 'vendor', 'target', '.venv',
  'venv', '__pycache__', '.gradle', '.idea', 'Pods', 'DerivedData',
  'worktrees', '.worktrees', 'AppData', 'Application Data',
])

// Portable "is `child` inside (or equal to) `parent`?"
export function isUnder(child, parent) {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

// Per-cwd project slug, e.g. d:\claude-coding\atlas-labs -> d--claude-coding-atlas-labs
export const slugOf = (p) => path.resolve(p).replace(/[:\\/]/g, '-').toLowerCase()

// Cheap frontmatter (name + description) of a SKILL.md.
export function skillMeta(skillMd) {
  const txt = read(skillMd).slice(0, 4000)
  const fm = txt.match(/^---\s*([\s\S]*?)\s*---/)
  const block = fm ? fm[1] : txt
  const name = (block.match(/^name:\s*(.+)$/m)?.[1] || path.basename(path.dirname(skillMd))).trim()
  let desc = ''
  const dLine = block.match(/^description:\s*(.*)$/m)
  if (dLine) {
    if (/^[>|]/.test(dLine[1].trim()) || dLine[1].trim() === '') {
      const after = block.slice(block.indexOf(dLine[0]) + dLine[0].length)
      desc = after.split('\n').filter((l) => /^\s+\S/.test(l)).map((l) => l.trim()).join(' ')
    } else {
      desc = dLine[1].trim()
    }
  }
  return { name, description: desc.replace(/\s+/g, ' ').slice(0, 220) }
}

// List every <dir>/*/SKILL.md as {name, description, dir}.
export function listSkills(dir) {
  if (!isDir(dir)) return []
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const md = path.join(dir, e.name, 'SKILL.md')
    if (exists(md)) out.push({ dir: path.join(dir, e.name), ...skillMeta(md) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Bounded recursive walk. Calls onDir(fullPath, depth) for each directory.
export function walk(root, { depth = 6, onDir, budget = 200000 } = {}) {
  if (!isDir(root)) return
  const stack = [[path.resolve(root), 0]]
  let n = 0
  while (stack.length && n++ < budget) {
    const [cur, d] = stack.pop()
    if (onDir) onDir(cur, d)
    if (d >= depth) continue
    let entries = []
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (SKIP_DIRS.has(e.name)) continue
      if (e.name.startsWith('.') && e.name !== '.claude') continue
      stack.push([path.join(cur, e.name), d + 1])
    }
  }
}

export const rel = (p) => (p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p)
