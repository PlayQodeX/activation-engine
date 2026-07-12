#!/usr/bin/env node
// activation-engine/scan.mjs — walk the machine ONCE, persist an index of every
// skill / rule / guideline / coordination file so `activate` can bootstrap any
// workspace instantly in a later session without re-scanning.
//
// Usage:
//   node scan.mjs                       # scan ~ (home) + the whole ~/.claude tree
//   node scan.mjs --roots d:\code,e:\wk # scan these project roots instead of home
//   node scan.mjs --add-roots d:\code   # scan home AND these extra roots
//   node scan.mjs --depth 8             # recursion depth per root (default 6)
//   node scan.mjs --json                # also echo the index JSON to stdout
//
// Writes ~/.claude/activation-engine/index.json (+ index.md human mirror).
// Read-only against everything it scans; the ONLY writes are the two index files.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  HOME, GLOBAL_CLAUDE, STATE_DIR, INDEX_JSON, INDEX_MD,
  exists, isDir, read, listSkills, skillMeta, walk, rel,
} from './lib/common.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const asJson = flag('--json')

// Reuse the previous index's roots/depth when the user passes no root flags, so a
// bare re-scan (e.g. /activate-scan) covers the same tree as last time instead of
// silently shrinking to home-only. Override anytime with --roots/--add-roots, or
// force a home-only baseline with --home.
const prevIndex = exists(INDEX_JSON) ? (() => { try { return JSON.parse(read(INDEX_JSON)) } catch { return null } })() : null
const explicitRoots = (val('--roots') || '').split(',').map((s) => s.trim()).filter(Boolean)
const addRoots = (val('--add-roots') || '').split(',').map((s) => s.trim()).filter(Boolean)
const reusePrev = !explicitRoots.length && !addRoots.length && !flag('--home') && prevIndex?.roots?.length
let roots = explicitRoots.length ? explicitRoots : (reusePrev ? prevIndex.roots : [HOME])
roots = [...new Set([...roots, ...addRoots].map((r) => path.resolve(r)))]
const depth = Number(val('--depth')) || (reusePrev && prevIndex.depth) || 6

const RULE_KINDS = { 'CLAUDE.md': 'CLAUDE.md', 'context.md': 'context.md', 'RTK.md': 'RTK.md' }
const COORD_KINDS = {
  'active-tasks.md': 'active-tasks', 'blockers.md': 'blockers',
  'known-bugs.md': 'known-bugs', 'known_bugs.md': 'known-bugs',
}

// ---- global layer (always, fully) ------------------------------------------
function scanGlobal() {
  const g = {
    claudeMd: exists(path.join(GLOBAL_CLAUDE, 'CLAUDE.md')) ? path.join(GLOBAL_CLAUDE, 'CLAUDE.md') : null,
    rtkMd: exists(path.join(GLOBAL_CLAUDE, 'RTK.md')) ? path.join(GLOBAL_CLAUDE, 'RTK.md') : null,
    skills: listSkills(path.join(GLOBAL_CLAUDE, 'skills')).map((s) => ({ ...s, trusted: true })),
    commands: [],
    pluginSkills: [],
    memory: [],
  }
  const cmdDir = path.join(GLOBAL_CLAUDE, 'commands')
  if (isDir(cmdDir)) g.commands = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort()

  // plugin skills (marketplaces + cache), deduped by name+leaf
  const pluginsRoot = path.join(GLOBAL_CLAUDE, 'plugins')
  const seen = new Set()
  walk(pluginsRoot, {
    depth: 10,
    onDir: (dir) => {
      if (path.basename(dir) !== 'skills') return
      for (const s of listSkills(dir)) {
        if (seen.has(s.name)) continue // collapse marketplace/cache mirrors
        seen.add(s.name)
        // plugin skills are third-party by default -> untrusted until vouched for
        g.pluginSkills.push({ name: s.name, dir: s.dir, trusted: false })
      }
    },
  })
  g.pluginSkills.sort((a, b) => a.name.localeCompare(b.name))

  // per-project memory indexes
  const projRoot = path.join(GLOBAL_CLAUDE, 'projects')
  if (isDir(projRoot)) {
    for (const d of fs.readdirSync(projRoot)) {
      const mem = path.join(projRoot, d, 'memory', 'MEMORY.md')
      if (exists(mem)) g.memory.push({ project: d, path: mem })
    }
  }
  return g
}

// ---- project layer (bounded walk of each root) -----------------------------
function scanRoots() {
  const ruleFiles = []
  const coordFiles = []
  const workspaceSkills = []
  const gitRoots = new Set()
  const seenSkill = new Set()

  for (const root of roots) {
    walk(root, {
      depth,
      onDir: (dir) => {
        if (isDir(path.join(dir, '.git'))) gitRoots.add(dir)
        // rule + coord files that sit directly in this dir
        let entries = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (!e.isFile()) continue
          if (RULE_KINDS[e.name]) ruleFiles.push({ path: path.join(dir, e.name), kind: RULE_KINDS[e.name] })
          if (COORD_KINDS[e.name]) coordFiles.push({ path: path.join(dir, e.name), kind: COORD_KINDS[e.name] })
        }
        // workspace skills: a `.claude/skills` dir
        if (path.basename(dir) === 'skills' && path.basename(path.dirname(dir)) === '.claude') {
          for (const s of listSkills(dir)) {
            const key = path.resolve(s.dir)
            if (seenSkill.has(key)) continue
            seenSkill.add(key)
            workspaceSkills.push({ ...s, trusted: true })
          }
        }
        // .claude/active-tasks.md
        if (path.basename(dir) === '.claude') {
          const at = path.join(dir, 'active-tasks.md')
          if (exists(at)) coordFiles.push({ path: at, kind: 'active-tasks' })
        }
      },
    })
  }
  // dedupe rule/coord by path
  const dedupe = (arr) => { const m = new Map(); for (const x of arr) m.set(x.path, x); return [...m.values()] }
  return {
    ruleFiles: dedupe(ruleFiles),
    coordFiles: dedupe(coordFiles),
    workspaceSkills,
    gitRoots: [...gitRoots].sort(),
  }
}

const global_ = scanGlobal()
const proj = scanRoots()

const index = {
  version: 1,
  scannedAt: new Date().toISOString(),
  host: os.hostname(),
  platform: process.platform,
  roots,
  depth,
  global: global_,
  ruleFiles: proj.ruleFiles,
  coordFiles: proj.coordFiles,
  workspaceSkills: proj.workspaceSkills,
  gitRoots: proj.gitRoots,
  stats: {
    globalSkills: global_.skills.length,
    pluginSkills: global_.pluginSkills.length,
    commands: global_.commands.length,
    memoryProjects: global_.memory.length,
    ruleFiles: proj.ruleFiles.length,
    coordFiles: proj.coordFiles.length,
    workspaceSkills: proj.workspaceSkills.length,
    gitRoots: proj.gitRoots.length,
  },
}

// mark skills NEW since the previous scan so activation can flag freshly-added ones
const prev = exists(INDEX_JSON) ? (() => { try { return JSON.parse(read(INDEX_JSON)) } catch { return null } })() : null
if (prev) {
  index.previousScannedAt = prev.scannedAt || null
  const prevIds = new Set()
  for (const s of prev.global?.skills || []) prevIds.add('g:' + s.name.toLowerCase())
  for (const s of prev.global?.pluginSkills || []) prevIds.add('p:' + s.name.toLowerCase())
  for (const s of prev.workspaceSkills || []) prevIds.add('w:' + path.resolve(s.dir).toLowerCase())
  const marks = []
  for (const s of index.global.skills) if (!prevIds.has('g:' + s.name.toLowerCase())) { s.new = true; marks.push('global:' + s.name) }
  for (const s of index.global.pluginSkills) if (!prevIds.has('p:' + s.name.toLowerCase())) { s.new = true; marks.push('plugin:' + s.name) }
  for (const s of index.workspaceSkills) if (!prevIds.has('w:' + path.resolve(s.dir).toLowerCase())) { s.new = true; marks.push('workspace:' + s.name) }
  index.newSinceLastScan = marks
} else {
  index.previousScannedAt = null
  index.newSinceLastScan = [] // first scan: baseline, nothing counts as new
}
index.stats.newSinceLastScan = index.newSinceLastScan.length
index.stats.untrustedPluginSkills = index.global.pluginSkills.length

fs.mkdirSync(STATE_DIR, { recursive: true })
fs.writeFileSync(INDEX_JSON, JSON.stringify(index, null, 2))

// human mirror
const md = []
md.push('# activation-engine — machine index')
md.push('')
md.push(`- scanned: ${index.scannedAt}`)
md.push(`- host: ${index.host} (${index.platform})`)
md.push(`- roots: ${roots.map(rel).join(', ')}  (depth ${depth})`)
md.push('')
md.push('## Stats')
for (const [k, v] of Object.entries(index.stats)) md.push(`- ${k}: ${v}`)
md.push('')
if (index.newSinceLastScan.length) {
  md.push(`## New since last scan (${index.newSinceLastScan.length})`)
  for (const n of index.newSinceLastScan) md.push(`- ${n}`)
  md.push('')
}
md.push(`## Global skills (${global_.skills.length})`)
for (const s of global_.skills) md.push(`- **${s.name}** — ${s.description.slice(0, 100)}`)
md.push('')
md.push(`## Plugin skills (${global_.pluginSkills.length})`)
md.push(global_.pluginSkills.map((s) => s.name).join(', ') || '(none)')
md.push('')
md.push(`## Global commands (${global_.commands.length})`)
md.push(global_.commands.join(', ') || '(none)')
md.push('')
md.push(`## Git roots found (${proj.gitRoots.length})`)
for (const r of proj.gitRoots) md.push(`- ${rel(r)}`)
md.push('')
md.push(`## Workspace skills (${proj.workspaceSkills.length})`)
for (const s of proj.workspaceSkills) md.push(`- ${s.name} — ${rel(s.dir)}`)
fs.writeFileSync(INDEX_MD, md.join('\n'))

console.error(`[scan] indexed ${roots.length} root(s) @ depth ${depth}${reusePrev ? ' (reused previous roots)' : ''}: ${roots.map(rel).join(', ')}`)
console.error(`[scan] wrote ${rel(INDEX_JSON)}`)
for (const [k, v] of Object.entries(index.stats)) console.error(`         ${k}: ${v}`)
if (index.newSinceLastScan.length) {
  console.error(`[scan] NEW since last scan (${index.newSinceLastScan.length}): ${index.newSinceLastScan.slice(0, 12).join(', ')}${index.newSinceLastScan.length > 12 ? ' …' : ''}`)
  console.error('[scan] review new/untrusted skills before curating them into an instance.')
} else if (prev) {
  console.error('[scan] no new skills since last scan.')
}

if (asJson) console.log(JSON.stringify(index, null, 2))
