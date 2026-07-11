// activation-engine/lib/common.mjs
// Shared, zero-dependency helpers (node: builtins only). Read-only filesystem.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const HOME = os.homedir()
export const GLOBAL_CLAUDE = path.join(HOME, '.claude')
// Where the persisted scan index lives (survives skill re-clone / update).
export const STATE_DIR = path.join(GLOBAL_CLAUDE, 'activation-engine')
export const INDEX_JSON = path.join(STATE_DIR, 'index.json')
export const INDEX_MD = path.join(STATE_DIR, 'index.md')
// Instances = named, editable bundles of skills/rules/guidelines.
export const INSTANCES_DIR = path.join(STATE_DIR, 'instances')
// Generated slash commands (one per instance) live here.
export const COMMANDS_DIR = path.join(GLOBAL_CLAUDE, 'commands')
export const CMD_PREFIX = 'activate-'
export const CMD_MARKER = 'generated-by: activation-engine'

// Normalise a display name to a filesystem/command-safe slug.
export const kebab = (s) => String(s).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const instancePath = (slug) => path.join(INSTANCES_DIR, kebab(slug) + '.json')

export function listInstances() {
  if (!isDir(INSTANCES_DIR)) return []
  return fs.readdirSync(INSTANCES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(read(path.join(INSTANCES_DIR, f))) } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

// Resolve by slug OR case-insensitive display name.
export function readInstance(nameOrSlug) {
  const p = instancePath(nameOrSlug)
  if (exists(p)) { try { return JSON.parse(read(p)) } catch { return null } }
  const n = String(nameOrSlug).toLowerCase()
  return listInstances().find((i) => i.name.toLowerCase() === n || i.slug === kebab(nameOrSlug)) || null
}

export function writeInstance(inst) {
  fs.mkdirSync(INSTANCES_DIR, { recursive: true })
  fs.writeFileSync(instancePath(inst.slug), JSON.stringify(inst, null, 2))
}

export function deleteInstance(slug) {
  const p = instancePath(slug)
  if (exists(p)) { fs.unlinkSync(p); return true }
  return false
}

// ---- small per-machine state (default/last instance) ------------------------
export const STATE_JSON = path.join(STATE_DIR, 'state.json')
export function readState() { try { return JSON.parse(read(STATE_JSON)) } catch { return { defaults: {}, last: null } } }
export function writeState(s) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE_JSON, JSON.stringify(s, null, 2)) }

// ---- portable path helpers (for instance export/import) ---------------------
export const expandHome = (p) => (typeof p === 'string' && p.startsWith('~')) ? path.resolve(path.join(HOME, p.slice(1))) : p
export const collapseHome = (p) => {
  if (typeof p !== 'string') return p
  const abs = path.resolve(expandHome(p))
  return abs.startsWith(HOME) ? ('~' + abs.slice(HOME.length)).replace(/\\/g, '/') : abs
}

// ---- shared resolvers (used by activate.mjs AND instance.mjs) ---------------
export const ancestorsOf = (p) => {
  const out = []
  let cur = path.resolve(p)
  for (;;) { out.push(cur); const par = path.dirname(cur); if (par === cur) break; cur = par }
  return out
}

// nearest project memory for a folder (ancestor walk, case-insensitive slug)
export function memoryFor(index, dir) {
  for (const a of ancestorsOf(dir)) {
    const s = slugOf(a)
    const hit = (index.global?.memory || []).find((m) => m.project.toLowerCase() === s)
    if (hit) return hit
  }
  const base = path.basename(path.resolve(dir)).toLowerCase()
  return (index.global?.memory || [])
    .filter((m) => m.project.toLowerCase().includes(base))
    .sort((x, y) => y.project.length - x.project.length)[0] || null
}

// find an indexed skill (global | workspace | plugin) by name, case-insensitive.
// carries the `trusted` bit (global/workspace = trusted; plugin = trusted only if scan marked it so).
export function findSkill(index, name) {
  const n = String(name).toLowerCase()
  const g = (index.global?.skills || []).find((s) => s.name.toLowerCase() === n)
  if (g) return { name: g.name, where: 'global', dir: g.dir, trusted: g.trusted !== false, isNew: !!g.new }
  const w = (index.workspaceSkills || []).find((s) => s.name.toLowerCase() === n)
  if (w) return { name: w.name, where: 'workspace', dir: w.dir, trusted: w.trusted !== false, isNew: !!w.new }
  const p = (index.global?.pluginSkills || []).find((s) => s.name.toLowerCase() === n)
  if (p) return { name: p.name, where: 'plugin', dir: p.dir, trusted: p.trusted === true, isNew: !!p.new }
  return null
}

// classify a rule/guideline entry: existing file, memory-file slug, or literal text.
export function classifyRef(index, ref) {
  const abs = path.resolve(expandHome(ref))
  if (exists(abs)) return { ref, kind: 'file', path: abs }
  for (const m of index.global?.memory || []) {
    const cand = path.join(path.dirname(m.path), String(ref).endsWith('.md') ? ref : ref + '.md')
    if (exists(cand)) return { ref, kind: 'memory', path: cand }
  }
  return { ref, kind: 'literal' }
}

// resolve the operating stack that applies to a target folder from the index.
export function resolveWorkspace(index, targetIn) {
  const target = path.resolve(targetIn)
  const repoRoot = (index.gitRoots || [])
    .filter((r) => isUnder(target, r))
    .sort((a, b) => b.length - a.length)[0] || target
  const ruleStack = []
  if (index.global?.claudeMd) ruleStack.push({ scope: 'global', kind: 'CLAUDE.md', path: index.global.claudeMd })
  if (index.global?.rtkMd) ruleStack.push({ scope: 'global', kind: 'RTK.md', path: index.global.rtkMd })
  const anc = (index.ruleFiles || [])
    .filter((r) => isUnder(target, path.dirname(r.path)))
    .sort((a, b) => path.dirname(a.path).length - path.dirname(b.path).length)
  for (const r of anc) {
    ruleStack.push({ scope: path.dirname(r.path) === target ? 'target' : (path.dirname(r.path) === repoRoot ? 'repo' : 'app'), kind: r.kind, path: r.path })
  }
  const coordFiles = (index.coordFiles || []).filter((c) => isUnder(target, path.dirname(c.path)))
  const memory = memoryFor(index, target)
  const projectDirOf = (d) => d.split(/[\\/]\.claude[\\/]skills[\\/]/)[0]
  const workspaceSkills = (index.workspaceSkills || []).filter((s) => {
    const pd = projectDirOf(s.dir)
    return isUnder(target, pd) || isUnder(pd, repoRoot)
  })
  return { target, repoRoot, ruleStack, coordFiles, memory, workspaceSkills }
}

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
